import type { Desk } from "../desk";
import type { FamilyLink } from "../family";
import type { Metrics, Updates } from "../lib/api";

// One copy of a household, shared by every tab of this browser. A fresh copy is not read from the server again.
export const CARE_STORAGE_KEY = "saathi.care:v1";
export const FRESH_MS = 15 * 60 * 1000;
// The demo household is one shared account: anyone may have changed it, so a copy is trusted only briefly.
export const DEMO_FRESH_MS = 30 * 1000;
// An open care desk asks again this often (while the tab is visible), so new conversations and other people's
// edits show up without a reload. The server keeps its own short copies, so this costs few database reads.
export const POLL_MS = 60 * 1000;
export const DEMO_HOUSEHOLD_ID = "demo-kamla-sharma";

export type CareRecord = {
  desk: Desk | null;
  updates: Updates | null;
  metrics: Metrics | null;
  family: FamilyLink | null;
  readAt: number;
  familyAt: number;
};

export function isFresh(at: number, now = Date.now(), limit = FRESH_MS): boolean {
  return at > 0 && now - at < limit;
}

function emptyRecord(): CareRecord {
  return { desk: null, updates: null, metrics: null, family: null, readAt: 0, familyAt: 0 };
}

function legacyDesks(): Record<string, Desk> {
  const found: Record<string, Desk> = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith("saathi.desk.")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const desk = JSON.parse(raw) as Desk;
      const id = key === "saathi.desk.demo.v2" ? DEMO_HOUSEHOLD_ID : key.slice("saathi.desk.".length);
      if (id && id !== "local") found[id] = desk;
    }
  } catch {
    // A broken older copy is ignored; the server is read once.
  }
  return found;
}

function legacyFamily(): Record<string, FamilyLink> {
  const found: Record<string, FamilyLink> = {};
  try {
    const raw = localStorage.getItem("saathi.family");
    if (!raw) return found;
    const store = JSON.parse(raw) as Record<string, FamilyLink>;
    for (const link of Object.values(store)) {
      if (!link?.household) continue;
      const current = found[link.household];
      if (!current || link.joinedAt || link.createdAt > current.createdAt) found[link.household] = link;
    }
  } catch {
    // Same as a missing code: one read fills it in.
  }
  return found;
}

export function loadCareCache(): Record<string, CareRecord> {
  const byId: Record<string, CareRecord> = {};
  try {
    const raw = localStorage.getItem(CARE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, Partial<CareRecord>>;
      for (const [id, row] of Object.entries(parsed)) {
        byId[id] = { ...emptyRecord(), ...row };
      }
    }
  } catch {
    // Start from the older per-screen keys below.
  }
  for (const [id, desk] of Object.entries(legacyDesks())) {
    if (!byId[id]?.desk) byId[id] = { ...(byId[id] ?? emptyRecord()), desk, readAt: byId[id]?.readAt ?? 0 };
  }
  for (const [id, family] of Object.entries(legacyFamily())) {
    if (!byId[id]?.family) byId[id] = { ...(byId[id] ?? emptyRecord()), family, familyAt: byId[id]?.familyAt ?? 0 };
  }
  return byId;
}

export function saveCareCache(byId: Record<string, CareRecord>): void {
  const stored: Record<string, CareRecord> = {};
  for (const [id, row] of Object.entries(byId)) {
    stored[id] = {
      desk: row.desk,
      updates: row.updates,
      metrics: row.metrics,
      family: row.family,
      readAt: row.readAt,
      familyAt: row.familyAt,
    };
  }
  try {
    localStorage.setItem(CARE_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or a full disk: the Redux copy still lasts for this tab.
  }
}
