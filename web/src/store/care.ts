import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Desk, Medicine } from "../desk";
import { createPairingLink, fetchDesk, fetchMetrics, fetchPairing, fetchUpdates, pausedForMs, saveDesk } from "../lib/api";
import { clearSession } from "../session";
import type { SyncState } from "../desk";
import { isFresh, loadCareCache, saveCareCache, type CareRecord } from "./storage";

type Row = CareRecord & {
  loaded: boolean;
  dirty: boolean;
  sync: SyncState;
  syncedAt: number | null;
  error: string;
};

type CareState = { byId: Record<string, Row> };

const readsInFlight = new Set<string>();
const savesInFlight = new Set<string>();
const familyInFlight = new Set<string>();

function rowFrom(record: CareRecord): Row {
  return {
    ...record,
    loaded: record.desk !== null || record.readAt > 0,
    dirty: false,
    sync: record.desk ? "synced" : "loading",
    syncedAt: record.readAt || null,
    error: "",
  };
}

function persist(byId: Record<string, Row>): void {
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
  saveCareCache(stored);
}

function ensure(state: CareState, id: string): Row {
  if (!state.byId[id]) state.byId[id] = rowFrom({ desk: null, updates: null, metrics: null, family: null, readAt: 0, familyAt: 0 });
  return state.byId[id];
}

function mergeDesk(base: Desk, server: Desk): { desk: Desk; dirty: boolean } {
  const profile = { ...base.profile };
  for (const [key, value] of Object.entries(server.profile ?? {})) {
    if (value !== "" && value !== undefined && value !== null) (profile as Record<string, unknown>)[key] = value;
  }
  const known = new Map<string, Medicine["kind"]>([...base.medicines, ...(server.medicines ?? [])].map((item) => [item.id, item.kind]));
  const medicines = (server.medicines ?? base.medicines).map((item) => (item.kind ? item : { ...item, kind: known.get(item.id) }));
  return {
    desk: { ...base, ...server, profile, medicines },
    dirty: !server.profile?.preferredName && Boolean(profile.preferredName),
  };
}

type LoadArg = { householdId: string; demo: boolean; seed?: Desk; force?: boolean };

export const loadCareSnapshot = createAsyncThunk(
  "care/loadSnapshot",
  async ({ householdId, demo, force }: LoadArg, { getState, rejectWithValue }) => {
    // A forced refresh is for the numbers a demo action or a call just changed. A fresh desk is not read again.
    const row = (getState() as { care: CareState }).care.byId[householdId];
    const keepDesk = Boolean(force && row?.desk && !row.dirty && isFresh(row.readAt));
    try {
      const [desk, updates, metrics] = await Promise.all([
        keepDesk ? Promise.resolve(null) : fetchDesk(householdId, demo),
        fetchUpdates(householdId, Boolean(force)),
        fetchMetrics(householdId, 14, Boolean(force)),
      ]);
      return { householdId, desk, updates, metrics, readAt: Date.now() };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (!demo && status === 401) {
        clearSession();
        window.location.assign("/login?next=/care");
      }
      return rejectWithValue({ householdId, message: err instanceof Error ? err.message : "Could not reach the server." });
    } finally {
      readsInFlight.delete(householdId);
    }
  },
  {
    condition: ({ householdId, force }, { getState }) => {
      if (!householdId || householdId === "local" || pausedForMs() > 0 || readsInFlight.has(householdId)) return false;
      const row = (getState() as { care: CareState }).care.byId[householdId];
      if (!force && row?.desk && isFresh(row.readAt)) return false;
      readsInFlight.add(householdId);
      return true;
    },
  },
);

export const saveCareDesk = createAsyncThunk(
  "care/saveDesk",
  async ({ householdId, demo }: { householdId: string; demo: boolean }, { getState, rejectWithValue }) => {
    const row = (getState() as { care: CareState }).care.byId[householdId];
    if (!row?.desk) return rejectWithValue({ householdId, message: "Nothing to save." });
    try {
      await saveDesk(householdId, row.desk, demo);
      return { householdId, readAt: Date.now() };
    } catch (err) {
      return rejectWithValue({ householdId, message: err instanceof Error ? err.message : "Could not save." });
    } finally {
      savesInFlight.delete(householdId);
    }
  },
  {
    condition: ({ householdId }, { getState }) => {
      const row = (getState() as { care: CareState }).care.byId[householdId];
      if (!row?.dirty || !row.desk || !row.loaded || savesInFlight.has(householdId) || pausedForMs() > 0) return false;
      savesInFlight.add(householdId);
      return true;
    },
  },
);

export const loadFamilyLink = createAsyncThunk(
  "care/loadFamily",
  async (householdId: string, { rejectWithValue }) => {
    try {
      const family = await fetchPairing(householdId);
      return { householdId, family, familyAt: Date.now() };
    } catch (err) {
      return rejectWithValue({ householdId, message: err instanceof Error ? err.message : "Could not load the family code." });
    } finally {
      familyInFlight.delete(householdId);
    }
  },
  {
    condition: (householdId, { getState }) => {
      if (!householdId || familyInFlight.has(householdId) || pausedForMs() > 0) return false;
      const row = (getState() as { care: CareState }).care.byId[householdId];
      if (isFresh(row?.familyAt ?? 0)) return false;
      familyInFlight.add(householdId);
      return true;
    },
  },
);

export const createFamilyLink = createAsyncThunk(
  "care/createFamily",
  async ({ householdId, caretakerName, parentName }: { householdId: string; caretakerName: string; parentName: string }) => {
    const family = await createPairingLink(householdId, caretakerName, parentName);
    return { householdId, family, familyAt: Date.now() };
  },
);

const initialById = loadCareCache();
const initialRows: Record<string, Row> = {};
for (const [id, record] of Object.entries(initialById)) initialRows[id] = rowFrom(record);

const careSlice = createSlice({
  name: "care",
  initialState: { byId: initialRows } as CareState,
  reducers: {
    // Another tab of this browser read or saved a household. Its copy wins unless this tab has unsaved edits.
    careHydrated(state, action: PayloadAction<Record<string, CareRecord>>) {
      for (const [id, record] of Object.entries(action.payload)) {
        const row = state.byId[id];
        if (!row) {
          state.byId[id] = rowFrom(record);
          continue;
        }
        if (!row.dirty && record.readAt >= row.readAt) {
          Object.assign(row, { desk: record.desk, updates: record.updates, metrics: record.metrics, readAt: record.readAt });
          row.syncedAt = record.readAt || row.syncedAt;
          row.loaded = row.loaded || record.desk !== null;
        }
        if (record.familyAt > row.familyAt) {
          row.family = record.family;
          row.familyAt = record.familyAt;
        }
      }
    },
    careCleared(state) {
      state.byId = {};
    },
    deskEdited(state, action: PayloadAction<{ householdId: string; desk: Desk }>) {
      const row = ensure(state, action.payload.householdId);
      row.desk = action.payload.desk;
      row.loaded = true;
      row.dirty = true;
      row.error = "";
      persist(state.byId);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadCareSnapshot.pending, (state, action) => {
        const row = ensure(state, action.meta.arg.householdId);
        if (!row.desk) row.sync = "loading";
        row.error = "";
      })
      .addCase(loadCareSnapshot.fulfilled, (state, action) => {
        const { householdId, desk, updates, metrics, readAt } = action.payload;
        const row = ensure(state, householdId);
        const seed = action.meta.arg.seed;
        const base = row.dirty && row.desk ? row.desk : (row.desk ?? seed ?? desk);
        if (!row.dirty && desk && base) {
          const merged = mergeDesk(base, desk);
          row.desk = merged.desk;
          row.dirty = merged.dirty;
        }
        row.updates = updates;
        row.metrics = metrics;
        row.readAt = readAt;
        row.loaded = true;
        row.sync = row.dirty ? "saving" : "synced";
        row.syncedAt = readAt;
        row.error = "";
        persist(state.byId);
      })
      .addCase(loadCareSnapshot.rejected, (state, action) => {
        const payload = action.payload as { householdId: string; message: string } | undefined;
        const id = payload?.householdId ?? action.meta.arg.householdId;
        const row = ensure(state, id);
        row.sync = row.desk ? "synced" : "offline";
        row.error = row.desk ? "" : (payload?.message ?? "Could not reach the server.");
        if (!row.desk) row.loaded = true;
      })
      .addCase(saveCareDesk.pending, (state, action) => {
        const row = ensure(state, action.meta.arg.householdId);
        row.sync = "saving";
      })
      .addCase(saveCareDesk.fulfilled, (state, action) => {
        if (!action.payload) return;
        const row = ensure(state, action.payload.householdId);
        row.dirty = false;
        row.sync = "synced";
        row.syncedAt = action.payload.readAt;
        row.readAt = action.payload.readAt;
        row.error = "";
        persist(state.byId);
      })
      .addCase(saveCareDesk.rejected, (state, action) => {
        const payload = action.payload as { householdId: string; message: string } | undefined;
        const id = payload?.householdId ?? action.meta.arg.householdId;
        const row = ensure(state, id);
        row.dirty = true;
        row.sync = "offline";
        row.error = payload?.message ?? "Could not save.";
      })
      .addCase(loadFamilyLink.fulfilled, (state, action) => {
        const row = ensure(state, action.payload.householdId);
        row.family = action.payload.family;
        row.familyAt = action.payload.familyAt;
        persist(state.byId);
      })
      .addCase(createFamilyLink.fulfilled, (state, action) => {
        const row = ensure(state, action.payload.householdId);
        row.family = action.payload.family;
        row.familyAt = action.payload.familyAt;
        persist(state.byId);
      });
  },
});

export const { deskEdited, careHydrated, careCleared } = careSlice.actions;
export default careSlice.reducer;
