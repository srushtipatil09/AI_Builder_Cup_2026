import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMetrics, fetchUpdates, type Metrics, type Updates } from "./api";

export type UpdatesState = {
  updates: Updates | null;
  metrics: Metrics | null;
  error: boolean;
  loadedAt: number | null;
  refresh: () => void;
};

// Polls the care desk data every 10 seconds while the tab is visible. Nothing is stored in this browser.
export function useUpdates(householdId: string, enabled = true, intervalMs = 10_000): UpdatesState {
  const [updates, setUpdates] = useState<Updates | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!householdId || !enabled) return;
    try {
      const [u, m] = await Promise.all([fetchUpdates(householdId), fetchMetrics(householdId, 14)]);
      if (!alive.current) return;
      setUpdates(u);
      setMetrics(m);
      setError(false);
      setLoadedAt(Date.now());
    } catch {
      if (alive.current) setError(true);
    }
  }, [householdId, enabled]);

  useEffect(() => {
    alive.current = true;
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, intervalMs]);

  return { updates, metrics, error, loadedAt, refresh: () => void load() };
}
