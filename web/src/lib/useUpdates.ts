import { useCallback, useEffect } from "react";
import type { Metrics, Updates } from "./api";
import { loadCareSnapshot } from "../store/care";
import { useAppDispatch, useAppSelector } from "../store";

export type UpdatesState = {
  updates: Updates | null;
  metrics: Metrics | null;
  error: boolean;
  loadedAt: number | null;
  refresh: () => void;
};

// The routine numbers live in the same Redux record as the desk. A fresh local copy is shown as-is.
// refresh() is the one read after the caretaker runs something that should change those numbers.
export function useUpdates(householdId: string, enabled = true): UpdatesState {
  const dispatch = useAppDispatch();
  const row = useAppSelector((state) => (householdId ? state.care.byId[householdId] : undefined));
  const demo = householdId.startsWith("demo");

  useEffect(() => {
    if (!enabled || !householdId) return;
    void dispatch(loadCareSnapshot({ householdId, demo }));
  }, [demo, dispatch, enabled, householdId]);

  const refresh = useCallback(() => {
    if (!householdId) return;
    void dispatch(loadCareSnapshot({ householdId, demo, force: true }));
  }, [demo, dispatch, householdId]);

  return {
    updates: row?.updates ?? null,
    metrics: row?.metrics ?? null,
    error: Boolean(row?.error) && !row?.updates,
    loadedAt: row?.readAt || null,
    refresh,
  };
}
