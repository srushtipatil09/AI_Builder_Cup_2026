import { useCallback, useEffect } from "react";
import type { Metrics, Updates } from "./api";
import { loadCareSnapshot } from "../store/care";
import { useAppDispatch, useAppSelector } from "../store";
import { POLL_MS } from "../store/storage";

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

  // While the desk is open and visible it asks again every minute, and at once when the tab comes back into view.
  // That is how a conversation the parent just had, or an edit by another caretaker, reaches this screen.
  useEffect(() => {
    if (!enabled || !householdId) return;
    const poll = () => {
      if (document.visibilityState === "visible") void dispatch(loadCareSnapshot({ householdId, demo, maxAgeMs: POLL_MS - 5000 }));
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
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
