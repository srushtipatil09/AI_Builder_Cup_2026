import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  fetchCategories,
  fetchFamilyMembers,
  fetchNearby,
  fileLink,
  listFiles,
  pausedForMs,
  type FamilyMember,
  type FileCategory,
  type Nearby,
  type NearbyItem,
  type NearbyKind,
  type StoredFile,
} from "../lib/api";

// Reads that change slowly, kept in Redux and in localStorage so a reload, a second tab, or reopening a sheet
// does not ask the server again. Each kind has its own age limit. Writes (upload, delete, share location, add
// a family member) drop or refresh the copy they change.
export const READS_STORAGE_KEY = "saathi.reads:v1";

// Places near a home do not move; each one is a paid Places lookup, so they are kept longest.
export const PLACES_FRESH_MS = 6 * 60 * 60 * 1000;
// A lookup that failed is tried again after a minute, not after six hours.
const FAILED_FRESH_MS = 60 * 1000;
// "Open now" is only shown while the lookup is recent.
export const OPEN_NOW_FRESH_MS = 45 * 60 * 1000;
// Trusted people come from the desk, which the family can edit from another device.
const PEOPLE_FRESH_MS = 30 * 60 * 1000;
const HELPLINES_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const CATEGORIES_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const FILES_FRESH_MS = 10 * 60 * 1000;
// The shared demo's files can be changed by anyone trying it.
const DEMO_FILES_FRESH_MS = 60 * 1000;
const MEMBERS_FRESH_MS = 10 * 60 * 1000;
// Private file links stop working after 30 minutes; one is reused until 5 minutes before that.
const LINK_DEFAULT_MS = 30 * 60 * 1000;
const LINK_MARGIN_MS = 5 * 60 * 1000;

export type PlaceKind = NearbyKind;
export type NearbyTab = PlaceKind | "people" | "helplines";

type Stamped<T> = { value: T; at: number };

export type NearbyRecord = {
  location: Nearby["location"] | null;
  people: Stamped<NearbyItem[]> | null;
  helplines: Stamped<NearbyItem[]> | null;
  places: Partial<Record<PlaceKind, Stamped<NearbyItem[]> & { available: boolean }>>;
};

type ReadsState = {
  nearby: Record<string, NearbyRecord>;
  files: Record<string, Stamped<StoredFile[]>>;
  categories: Stamped<FileCategory[]> | null;
  members: Stamped<FamilyMember[]> | null;
  // Signed links to private files: kept in memory only, never written to localStorage.
  links: Record<string, { url: string; expiresAt: number }>;
};

const PLACE_KINDS: PlaceKind[] = ["hospital", "pharmacy", "park", "restaurant"];

const fresh = (at: number | undefined, limit: number, now = Date.now()) => Boolean(at) && now - (at ?? 0) < limit;

function emptyNearby(): NearbyRecord {
  return { location: null, people: null, helplines: null, places: {} };
}

function emptyState(): ReadsState {
  return { nearby: {}, files: {}, categories: null, members: null, links: {} };
}

export function loadReadsCache(): ReadsState {
  try {
    const raw = localStorage.getItem(READS_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<ReadsState>;
    return { ...emptyState(), ...parsed, links: {} };
  } catch {
    return emptyState();
  }
}

export function saveReadsCache(state: ReadsState): void {
  const { links: _private, ...stored } = state;
  try {
    localStorage.setItem(READS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or a full disk: the Redux copy still lasts for this tab.
  }
}

// What the nearby sheet can show for one tab without asking the server, or null when it must ask.
export function nearbyFromCache(record: NearbyRecord | undefined, tab: NearbyTab, now = Date.now()): Nearby | null {
  if (!record?.location) return null;
  const places: Nearby["places"] = {};
  let available = true;
  for (const kind of PLACE_KINDS) {
    const hit = record.places[kind];
    if (hit && fresh(hit.at, hit.available ? PLACES_FRESH_MS : FAILED_FRESH_MS, now)) {
      places[kind] = hit.value;
      if (!hit.available) available = false;
    }
  }
  if (tab === "people" && !fresh(record.people?.at, PEOPLE_FRESH_MS, now)) return null;
  if (tab === "helplines" && !fresh(record.helplines?.at, HELPLINES_FRESH_MS, now)) return null;
  if (tab !== "people" && tab !== "helplines" && !places[tab]) return null;
  return {
    location: record.location,
    people: record.people?.value ?? [],
    helplines: record.helplines?.value ?? [],
    places,
    available: tab === "people" || tab === "helplines" ? true : available,
  };
}

// The caretaker's card shows everything at once; it may use the cache only when every part is fresh.
export function nearbyAllFromCache(record: NearbyRecord | undefined, now = Date.now()): Nearby | null {
  if (!record) return null;
  const parts: NearbyTab[] = [...PLACE_KINDS, "people", "helplines"];
  if (parts.some((tab) => !nearbyFromCache(record, tab, now))) return null;
  return nearbyFromCache(record, "people", now);
}

export function placesAgeMs(record: NearbyRecord | undefined, kind: PlaceKind, now = Date.now()): number {
  const at = record?.places[kind]?.at;
  return at ? now - at : Infinity;
}

function mergeNearby(state: ReadsState, householdId: string, data: Nearby, at: number, kinds: PlaceKind[]): void {
  const row = state.nearby[householdId] ?? emptyNearby();
  // A new saved position makes every older place list about somewhere else.
  if (row.location && row.location.updatedAt !== data.location.updatedAt) row.places = {};
  row.location = data.location;
  row.people = { value: data.people ?? [], at };
  row.helplines = { value: data.helplines ?? [], at };
  for (const kind of kinds) {
    const items = data.places?.[kind];
    if (!items) continue;
    // The server marks the whole answer unavailable if any lookup failed; a list with places in it did not fail.
    row.places[kind] = { value: items, at, available: data.available || items.length > 0 };
  }
  state.nearby[householdId] = row;
}

const inFlight = new Set<string>();
function claim(key: string): boolean {
  if (inFlight.has(key) || pausedForMs() > 0) return false;
  inFlight.add(key);
  return true;
}

type ReadsRoot = { reads: ReadsState };

export const loadNearby = createAsyncThunk(
  "reads/loadNearby",
  async ({ householdId, tab }: { householdId: string; tab: NearbyTab | "all"; force?: boolean }) => {
    try {
      const data = await fetchNearby(householdId, tab);
      return { householdId, tab, data, at: Date.now() };
    } finally {
      inFlight.delete(`nearby:${householdId}:${tab}`);
    }
  },
  {
    condition: ({ householdId, tab, force }, { getState }) => {
      if (!householdId) return false;
      const record = (getState() as ReadsRoot).reads.nearby[householdId];
      const cached = tab === "all" ? nearbyAllFromCache(record) : nearbyFromCache(record, tab);
      if (!force && cached) return false;
      return claim(`nearby:${householdId}:${tab}`);
    },
  },
);

export const loadFiles = createAsyncThunk(
  "reads/loadFiles",
  async ({ householdId }: { householdId: string; force?: boolean }) => {
    try {
      return { householdId, files: await listFiles(householdId), at: Date.now() };
    } finally {
      inFlight.delete(`files:${householdId}`);
    }
  },
  {
    condition: ({ householdId, force }, { getState }) => {
      if (!householdId) return false;
      const hit = (getState() as ReadsRoot).reads.files[householdId];
      const limit = householdId.startsWith("demo-") ? DEMO_FILES_FRESH_MS : FILES_FRESH_MS;
      if (!force && hit && fresh(hit.at, limit)) return false;
      return claim(`files:${householdId}`);
    },
  },
);

export const loadCategories = createAsyncThunk(
  "reads/loadCategories",
  async () => {
    try {
      return { categories: await fetchCategories(), at: Date.now() };
    } finally {
      inFlight.delete("categories");
    }
  },
  {
    condition: (_arg: void, { getState }) => {
      const hit = (getState() as ReadsRoot).reads.categories;
      if (hit && fresh(hit.at, CATEGORIES_FRESH_MS)) return false;
      return claim("categories");
    },
  },
);

export const loadMembers = createAsyncThunk(
  "reads/loadMembers",
  async (_arg: { force?: boolean; maxAgeMs?: number } | undefined) => {
    try {
      return { members: await fetchFamilyMembers(), at: Date.now() };
    } finally {
      inFlight.delete("members");
    }
  },
  {
    condition: (arg, { getState }) => {
      const hit = (getState() as ReadsRoot).reads.members;
      if (!arg?.force && hit && fresh(hit.at, arg?.maxAgeMs ?? MEMBERS_FRESH_MS)) return false;
      return claim("members");
    },
  },
);

export const loadFileLink = createAsyncThunk(
  "reads/loadFileLink",
  async ({ householdId, fileId }: { householdId: string; fileId: string }) => {
    try {
      const link = await fileLink(householdId, fileId);
      const expiresAt = link.expiresAt
        ? new Date(link.expiresAt).getTime()
        : Date.now() + (link.expiresInSeconds ? link.expiresInSeconds * 1000 : LINK_DEFAULT_MS);
      return { fileId, url: link.url, expiresAt };
    } finally {
      inFlight.delete(`link:${fileId}`);
    }
  },
  {
    condition: ({ fileId }, { getState }) => {
      const hit = (getState() as ReadsRoot).reads.links[fileId];
      if (hit && hit.expiresAt - LINK_MARGIN_MS > Date.now()) return false;
      return claim(`link:${fileId}`);
    },
  },
);

export function linkUsable(hit: { expiresAt: number } | undefined, now = Date.now()): boolean {
  return Boolean(hit) && hit!.expiresAt - LINK_MARGIN_MS > now;
}

// A usable link to one file: the kept one while it still works, otherwise a new one.
export const fileUrl =
  (householdId: string, fileId: string) =>
  async (dispatch: (action: unknown) => unknown, getState: () => unknown): Promise<string> => {
    await (dispatch(loadFileLink({ householdId, fileId })) as Promise<unknown>);
    const hit = (getState() as ReadsRoot).reads.links[fileId];
    if (!hit) throw new Error("No link for that file.");
    return hit.url;
  };

const readsSlice = createSlice({
  name: "reads",
  initialState: loadReadsCache(),
  reducers: {
    // The voice assistant found places during a call: the same list fills the sheet, so opening it asks nothing.
    nearbyFound(state, action: PayloadAction<{ householdId: string; kind: string; items: NearbyItem[]; positionShared: boolean }>) {
      const { householdId, kind, items } = action.payload;
      if (!PLACE_KINDS.includes(kind as PlaceKind)) return;
      const row = state.nearby[householdId] ?? emptyNearby();
      if (!row.location) return;
      row.places[kind as PlaceKind] = { value: items, at: Date.now(), available: true };
      state.nearby[householdId] = row;
    },
    // The parent shared or removed a position: the old places are for somewhere else.
    nearbyForget(state, action: PayloadAction<string>) {
      delete state.nearby[action.payload];
    },
    memberAdded(state, action: PayloadAction<FamilyMember>) {
      state.members = { value: [...(state.members?.value ?? []), action.payload], at: state.members?.at ?? 0 };
    },
    fileLinksForget(state, action: PayloadAction<string[]>) {
      for (const id of action.payload) delete state.links[id];
    },
    // Another tab of this browser wrote newer copies.
    readsHydrated(state, action: PayloadAction<ReadsState>) {
      const next = action.payload;
      state.nearby = next.nearby ?? {};
      state.files = next.files ?? {};
      state.categories = next.categories ?? null;
      state.members = next.members ?? null;
    },
    readsCleared() {
      return emptyState();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadNearby.fulfilled, (state, action) => {
        const { householdId, tab, data, at } = action.payload;
        const kinds = tab === "all" ? PLACE_KINDS : PLACE_KINDS.filter((k) => k === tab);
        mergeNearby(state, householdId, data, at, kinds);
      })
      .addCase(loadFiles.fulfilled, (state, action) => {
        state.files[action.payload.householdId] = { value: action.payload.files, at: action.payload.at };
      })
      .addCase(loadCategories.fulfilled, (state, action) => {
        state.categories = { value: action.payload.categories, at: action.payload.at };
      })
      .addCase(loadMembers.fulfilled, (state, action) => {
        state.members = { value: action.payload.members, at: action.payload.at };
      })
      .addCase(loadFileLink.fulfilled, (state, action) => {
        state.links[action.payload.fileId] = { url: action.payload.url, expiresAt: action.payload.expiresAt };
      });
  },
});

export const { nearbyFound, nearbyForget, memberAdded, fileLinksForget, readsHydrated, readsCleared } = readsSlice.actions;
export default readsSlice.reducer;
