import { useCallback, useEffect, useRef, useState } from "react";

// Care desk records. Until Firestore writes land, they are kept in this browser only.

export type Profile = {
  preferredName: string;
  language: string;
  city: string;
  persona: "Saathi" | "Rakshak";
  checkIn: string;
  // "HH:MM-HH:MM" from the desk form. Older free text is kept and shown as written.
  quietHours: string;
};

export type Person = { id: string; name: string; relation: string; city: string };

// A caretaker fact. Source is always caregiver; the author and time are shown on the row.
export type Memory = { id: string; text: string; author: string; addedAt: string; editedAt?: string };

export type ReminderKind = "medicine" | "exercise" | "call" | "meal" | "other";

// Labels for each kind of reminder. For a medicine, the detail is the dose, copied exactly as written.
export const reminderKinds: Record<
  ReminderKind,
  { label: string; name: string; namePlaceholder: string; detail: string; detailPlaceholder: string; notePlaceholder: string }
> = {
  medicine: {
    label: "Medicine",
    name: "Medicine name",
    namePlaceholder: "As written on the strip",
    detail: "Dose, as the doctor wrote it",
    detailPlaceholder: "Copied from the prescription",
    notePlaceholder: "e.g. after breakfast",
  },
  exercise: {
    label: "Exercise",
    name: "Activity",
    namePlaceholder: "e.g. Morning walk",
    detail: "How long",
    detailPlaceholder: "e.g. 20 minutes",
    notePlaceholder: "e.g. in the park, with a friend",
  },
  call: {
    label: "Call",
    name: "Who to call",
    namePlaceholder: "e.g. Rahul",
    detail: "Why",
    detailPlaceholder: "e.g. his birthday",
    notePlaceholder: "e.g. he is free after 7",
  },
  meal: {
    label: "Food",
    name: "Meal or drink",
    namePlaceholder: "e.g. Lunch",
    detail: "What",
    detailPlaceholder: "e.g. dal chawal from the fridge",
    notePlaceholder: "e.g. warm it first",
  },
  other: {
    label: "Other",
    name: "Reminder",
    namePlaceholder: "e.g. Water the tulsi",
    detail: "Detail",
    detailPlaceholder: "Optional",
    notePlaceholder: "Anything Saathi should add",
  },
};

// Older reminders were all medicines and have no kind.
export function kindOf(m: { kind?: ReminderKind }): ReminderKind {
  return m.kind && m.kind in reminderKinds ? m.kind : "medicine";
}

// Any reminder: a medicine, a walk, a call, a meal. The name keeps its history.
// A dose is stored exactly as the family typed it. Saathi reads it back and never suggests one.
export type Medicine = {
  id: string;
  kind?: ReminderKind;
  name: string;
  // The dose for a medicine; a short detail for any other kind.
  dose: string;
  schedule: "Once" | "Daily";
  // Only for "Once": the local date, YYYY-MM-DD.
  date?: string;
  time: string;
  note: string;
  // The local date the parent's completion was last reported, and who recorded it.
  confirmedOn?: string;
  confirmedBy?: string;
};

export type Contact = { id: string; name: string; relation: string; phone: string; local: boolean };

export type Desk = {
  profile: Profile;
  people: Person[];
  memories: Memory[];
  medicines: Medicine[];
  contacts: Contact[];
};

// Today's local date as YYYY-MM-DD.
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "08:30" -> "8:30 AM" in the reader's locale. Empty stays "Not set".
export function formatClock(value: string): string {
  if (!/^\d{2}:\d{2}$/.test(value)) return value || "Not set";
  const [h, m] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function parseQuiet(value: string): [string, string] | null {
  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(value);
  return match ? [match[1], match[2]] : null;
}

export function formatQuiet(value: string): string {
  const range = parseQuiet(value);
  if (range) return `${formatClock(range[0])} – ${formatClock(range[1])}`;
  return value || "Not set";
}

export function formatDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// The words Saathi will say for a reminder, built only from what the family typed.
export function readBack(m: Pick<Medicine, "kind" | "name" | "dose" | "schedule" | "date" | "time" | "note">): string {
  // "Who to call" holds a name, so a call reads back as "Call Rahul".
  const name = m.kind === "call" && m.name && !/^call/i.test(m.name) ? `Call ${m.name}` : m.name;
  const when = m.schedule === "Once" && m.date ? `on ${formatDate(m.date)} at ${formatClock(m.time)}` : `every day at ${formatClock(m.time)}`;
  return [name, m.dose, when, m.note].filter(Boolean).join(", ") + ".";
}

// Loose check for an Indian or international phone number: digits with optional +, spaces, or dashes.
export function phoneProblem(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[\s()-]/g, "");
  return /^\+?\d{8,13}$/.test(digits) ? null : "Enter a phone number with 8 to 13 digits, like +91 98765 43210.";
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// A clock time a few minutes from now, rounded to five minutes, as HH:MM.
function soon(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000);
  const rounded = Math.round(date.getMinutes() / 5) * 5;
  date.setMinutes(rounded, 0, 0);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function demoDesk(): Desk {
  return {
    profile: {
      preferredName: "Kamla",
      language: "Hindi",
      city: "Varanasi",
      persona: "Saathi",
      checkIn: "",
      quietHours: "",
    },
    people: [{ id: "rahul", name: "Rahul", relation: "Son", city: "Bengaluru" }],
    memories: [],
    // Synthetic. Set 20 minutes after the demo opens so the Routine tab shows an urgent reminder.
    medicines: [
      { id: "bp", kind: "medicine", name: "BP tablet", dose: "", schedule: "Daily", time: soon(20), note: "" },
      { id: "walk", kind: "exercise", name: "Evening walk", dose: "20 minutes", schedule: "Daily", time: "18:00", note: "" },
    ],
    contacts: [{ id: "rahul", name: "Rahul", relation: "Son, caretaker", phone: "", local: false }],
  };
}

export function blankDesk(preferredName: string, language: string, city = ""): Desk {
  return {
    profile: { preferredName, language, city, persona: "Saathi", checkIn: "", quietHours: "" },
    people: [],
    memories: [],
    medicines: [],
    contacts: [],
  };
}

function read(key: string, seed: Desk): Desk {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return seed;
    return { ...seed, ...(JSON.parse(raw) as Partial<Desk>) };
  } catch {
    return seed;
  }
}

import { fetchDesk, saveDesk } from "./lib/api";
import { clearSession } from "./session";

export type SyncState = "loading" | "synced" | "saving" | "offline";

const SAVE_DELAY_MS = 600;
const RETRY_MS = 10_000;
const REFRESH_MS = 20_000;

// The care desk, kept in sync with Firestore through the API.
// - Nothing is sent to the server until its copy has been loaded, so a new device cannot overwrite it with a blank desk.
// - Edits are saved after a short pause. A failed save is kept and retried; the status says so.
// - With no unsaved edits, the desk refreshes every 20 seconds, when the tab regains focus, and when the network returns.
export function useDesk(key: string, seed: () => Desk) {
  const [desk, setDeskState] = useState<Desk>(() => read(key, seed()));
  const [sync, setSync] = useState<SyncState>("loading");
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState("");
  const dirty = useRef(false);
  const loaded = useRef(false);
  const saving = useRef(false);
  const latest = useRef(desk);
  latest.current = desk;
  const isDemo = key.includes("demo");
  const hhId = key.replace("saathi.desk.", "");

  const remember = useCallback(
    (next: Desk) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private mode: edits last until the tab closes.
      }
    },
    [key],
  );

  const setDesk: React.Dispatch<React.SetStateAction<Desk>> = useCallback((update) => {
    dirty.current = true;
    setDeskState((prev) => (typeof update === "function" ? (update as (d: Desk) => Desk)(prev) : update));
  }, []);

  const load = useCallback(async () => {
    if (saving.current) return;
    try {
      const server = await fetchDesk(hhId, isDemo);
      loaded.current = true;
      setSyncError("");
      if (dirty.current) {
        // Unsaved local edits win; they are saved next.
        setSyncedAt(Date.now());
        return;
      }
      const base = seed();
      // A brand-new server desk is empty; keep the names entered at signup and save them.
      const profile = { ...base.profile };
      for (const [k, v] of Object.entries(server.profile ?? {})) {
        if (v !== "" && v !== undefined && v !== null) (profile as Record<string, unknown>)[k] = v;
      }
      // An API older than reminder kinds drops the field. Keep the kind this browser already knows for that reminder.
      const known = new Map([...base.medicines, ...latest.current.medicines].map((m) => [m.id, m.kind]));
      const medicines = (server.medicines ?? base.medicines).map((m) => (m.kind ? m : { ...m, kind: known.get(m.id) }));
      const next = { ...base, ...server, profile, medicines };
      remember(next);
      setDeskState(next);
      if (!server.profile?.preferredName && profile.preferredName) dirty.current = true;
      setSync("synced");
      setSyncedAt(Date.now());
    } catch (err) {
      if (!isDemo && (err as { status?: number }).status === 401) {
        // The sign-in on this device has expired. Retrying will not help; log in again.
        clearSession();
        window.location.assign("/login?next=/care");
        return;
      }
      setSync("offline");
      setSyncError(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }, [hhId, isDemo, remember]);

  const flush = useCallback(async () => {
    if (!loaded.current || !dirty.current || saving.current) return;
    saving.current = true;
    setSync("saving");
    const sending = latest.current;
    dirty.current = false;
    try {
      await saveDesk(hhId, sending, isDemo);
      remember(sending);
      setSync(dirty.current ? "saving" : "synced");
      setSyncedAt(Date.now());
      setSyncError("");
    } catch (err) {
      dirty.current = true;
      setSync("offline");
      setSyncError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      saving.current = false;
    }
  }, [hhId, isDemo, remember]);

  // First load, then keep fresh.
  useEffect(() => {
    loaded.current = false;
    dirty.current = false;
    setSync("loading");
    void load();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (dirty.current) void flush();
      else void load();
    };
    const id = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load, flush]);

  // Save after edits, and retry while offline.
  useEffect(() => {
    if (!dirty.current) return;
    remember(desk);
    const wait = sync === "offline" ? RETRY_MS : SAVE_DELAY_MS;
    const id = window.setTimeout(() => {
      if (!loaded.current) void load().then(() => flush());
      else void flush();
    }, wait);
    return () => window.clearTimeout(id);
  }, [desk, sync, flush, load, remember]);

  function reset() {
    setDesk(seed());
  }

  const retry = useCallback(() => {
    if (dirty.current) void flush();
    else void load();
  }, [flush, load]);

  return { desk, setDesk, reset, sync, syncedAt, syncError, retry };
}
