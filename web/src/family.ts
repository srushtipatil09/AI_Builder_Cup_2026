import { useEffect, useState } from "react";

// A family code pairs the caretaker's desk with the parent's phone.
// This build keeps codes in the browser; a code made on one device is only recognised on another
// once cloud sync is connected. The join link carries only the code, never names.

const KEY = "saathi.family";

export type FamilyLink = {
  code: string;
  household: string;
  parentName: string;
  caretakerName: string;
  createdAt: string;
  joinedAt?: string;
  joinedName?: string;
};

type Store = Record<string, FamilyLink>;

// No 0/O, 1/I/L, so a code read aloud over the phone is not misheard.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private mode: the code still shows for this visit.
  }
}

function makeCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

// "kmr4f7", "KMR 4F7" and "kmr-4f7" all become "KMR-4F7".
export function normalizeCode(input: string): string {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length > 3 ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}` : clean;
}

export function isCode(input: string): boolean {
  return /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(normalizeCode(input));
}

export function joinUrl(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

export function findByCode(code: string): FamilyLink | null {
  return load()[normalizeCode(code)] ?? null;
}

export function markJoined(code: string, name: string) {
  const store = load();
  const link = store[normalizeCode(code)];
  if (!link) return;
  store[link.code] = { ...link, joinedAt: new Date().toISOString(), joinedName: name };
  save(store);
}

function forHousehold(household: string): FamilyLink | null {
  return Object.values(load()).find((l) => l.household === household) ?? null;
}

// The caretaker's view of the link: create it on demand, make a new one, and see when the parent joins.
export function useFamilyLink(household: string, parentName: string, caretakerName: string) {
  const [link, setLink] = useState<FamilyLink | null>(() => forHousehold(household));

  useEffect(() => {
    // A join in another tab of this browser updates the status here.
    const refresh = () => setLink(forHousehold(household));
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [household]);

  function create() {
    const store = load();
    for (const [code, l] of Object.entries(store)) if (l.household === household) delete store[code];
    const next: FamilyLink = {
      code: makeCode(),
      household,
      parentName,
      caretakerName,
      createdAt: new Date().toISOString(),
    };
    store[next.code] = next;
    save(store);
    setLink(next);
  }

  return { link, create };
}
