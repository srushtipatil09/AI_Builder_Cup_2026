import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { onSessionCleared } from "../session";
import care, { careCleared, careHydrated } from "./care";
import reads, { READS_STORAGE_KEY, loadReadsCache, readsCleared, readsHydrated, saveReadsCache } from "./reads";
import { CARE_STORAGE_KEY, loadCareCache } from "./storage";

export const store = configureStore({
  reducer: { care, reads },
});

// The reads copy is written to localStorage whenever it changes (the care copy writes itself on each change).
let lastReads = store.getState().reads;
let hydrating = false;
store.subscribe(() => {
  const next = store.getState().reads;
  if (next === lastReads) return;
  lastReads = next;
  // A copy taken from another tab is not written back, or the tabs would keep answering each other.
  if (!hydrating) saveReadsCache(next);
});

// Another tab of this browser read or saved something: take its copy instead of asking the server again.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === CARE_STORAGE_KEY) store.dispatch(careHydrated(loadCareCache()));
    if (event.key === READS_STORAGE_KEY) {
      hydrating = true;
      store.dispatch(readsHydrated(loadReadsCache()));
      hydrating = false;
    }
  });
}

// Logging out leaves nothing of that account in this tab or in localStorage.
onSessionCleared(() => {
  store.dispatch(careCleared());
  store.dispatch(readsCleared());
  try {
    localStorage.removeItem(CARE_STORAGE_KEY);
    localStorage.removeItem(READS_STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
  lastReads = store.getState().reads;
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
