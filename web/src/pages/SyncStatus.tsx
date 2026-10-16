import { useEffect, useState } from "react";
import type { SyncState } from "../desk";

type Props = {
  sync: SyncState;
  syncedAt: number | null;
  error?: string;
  onRetry: () => void;
  demo?: boolean;
};

function ago(at: number | null, now: number): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

// Says whether what is on screen matches Firestore. A failure is shown in words, with a way to try again.
export function SyncStatus({ sync, syncedAt, onRetry, demo }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  if (sync === "offline") {
    return (
      <div className="sync sync-bad" role="alert">
        <span>
          <strong>Changes are not saved yet.</strong> They are kept on this device and will retry.
        </span>
        <button className="ghost" type="button" onClick={onRetry}>
          Try now
        </button>
      </div>
    );
  }
  const text =
    sync === "loading"
      ? "Loading from the cloud…"
      : sync === "saving"
        ? "Saving…"
        : `${demo ? "Demo data" : "Saved to the cloud"}${syncedAt ? ` · checked ${ago(syncedAt, now)}` : ""}`;
  return (
    <p className={`sync sync-${sync}`} role="status" aria-live="polite">
      {text}
    </p>
  );
}
