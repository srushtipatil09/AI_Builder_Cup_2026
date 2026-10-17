import { useEffect, useState } from "react";
import { useToast } from "./toast";

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

import { lookupFamilyCode, pairFamilyCode } from "./lib/api";
import { createFamilyLink, loadFamilyLink } from "./store/care";
import { useAppDispatch, useAppSelector } from "./store";

export function findByCode(code: string): FamilyLink | null {
  return load()[normalizeCode(code)] ?? null;
}

// Tell the server the parent joined. Throws when the server cannot be reached, so the screen can say so.
export async function markJoined(code: string, name: string) {
  const norm = normalizeCode(code);
  await pairFamilyCode(norm, name);
  const store = load();
  const link = store[norm];
  if (!link) return;
  store[link.code] = { ...link, joinedAt: new Date().toISOString(), joinedName: name };
  save(store);
}

function forHousehold(household: string): FamilyLink | null {
  return Object.values(load()).find((l) => l.household === household) ?? null;
}

// The caretaker's family code. The browser keeps the last answer and reads the server once when that answer is stale.
export function useFamilyLink(household: string, parentName: string, caretakerName: string, enabled = true) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const cached = useAppSelector((state) => (household ? state.care.byId[household]?.family ?? null : null));
  const [busy, setBusy] = useState(false);
  const link = cached ?? forHousehold(household);

  useEffect(() => {
    if (!enabled || !household) return;
    void dispatch(loadFamilyLink(household));
  }, [dispatch, enabled, household]);

  async function create() {
    setBusy(true);
    try {
      const remote = await dispatch(createFamilyLink({ householdId: household, caretakerName, parentName })).unwrap();
      const store = load();
      for (const [code, item] of Object.entries(store)) if (item.household === household && code !== remote.family.code) delete store[code];
      store[remote.family.code] = remote.family;
      save(store);
    } catch {
      // A code made only on this device would not work on the parent's phone, so none is made.
      toast("Could not make a family code. Check the connection and try again.", "bad");
    } finally {
      setBusy(false);
    }
  }

  return { link, create, busy };
}

// The household a family code belongs to: this browser's record first, then the API.
export async function householdForCode(code: string): Promise<string | null> {
  const local = findByCode(code);
  if (local) return local.household;
  try {
    return (await lookupFamilyCode(normalizeCode(code))).household;
  } catch {
    return null;
  }
}

// Remember a link fetched from the API so this browser recognises the code from now on.
export function cacheLink(link: FamilyLink) {
  const store = load();
  store[link.code] = link;
  save(store);
}
