import { useEffect, useState } from "react";

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

// The dose is stored exactly as the family typed it. Saathi reads it back and never suggests one.
export type Medicine = {
  id: string;
  name: string;
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
export function readBack(m: Pick<Medicine, "name" | "dose" | "schedule" | "date" | "time" | "note">): string {
  const when = m.schedule === "Once" && m.date ? `on ${formatDate(m.date)} at ${formatClock(m.time)}` : `every day at ${formatClock(m.time)}`;
  return [m.name, m.dose, when, m.note].filter(Boolean).join(", ") + ".";
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
      { id: "bp", name: "BP tablet", dose: "", schedule: "Daily", time: soon(20), note: "" },
    ],
    contacts: [{ id: "rahul", name: "Rahul", relation: "Son, caretaker", phone: "", local: false }],
  };
}

export function blankDesk(preferredName: string, language: string): Desk {
  return {
    profile: { preferredName, language, city: "", persona: "Saathi", checkIn: "", quietHours: "" },
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

export function useDesk(key: string, seed: () => Desk) {
  const [desk, setDesk] = useState<Desk>(() => read(key, seed()));

  useEffect(() => {
    const isDemo = key.includes("demo");
    const hhId = key.replace("saathi.desk.", "");
    fetchDesk(hhId, isDemo)
      .then((serverDesk) => {
        if (serverDesk) {
          setDesk((prev) => ({ ...prev, ...serverDesk }));
        }
      })
      .catch(() => {
        // Keep local cache if offline or API unavailable
      });
  }, [key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(desk));
    } catch {
      // Private mode: edits last until the tab closes.
    }
    const isDemo = key.includes("demo");
    const hhId = key.replace("saathi.desk.", "");
    saveDesk(hhId, desk, isDemo).catch(() => {});
  }, [key, desk]);

  function reset() {
    setDesk(seed());
  }

  return { desk, setDesk, reset };
}

