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
export function SyncStatus({ sync, syncedAt, error, onRetry, demo }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  if (sync === "offline") {
    const paused = (error ?? "").includes("paused");
    return (
      <div className="sync sync-bad" role="alert">
        <span>
          {paused ? (
            <strong>Saving is paused for a moment, your changes are kept on this device.</strong>
          ) : (
            <>
              <strong>Changes are not saved yet.</strong> They are kept on this device and will retry.
            </>
          )}
        </span>
        <button className="ghost" type="button" onClick={onRetry}>
          Try now
        </button>
      </div>
    );
  }
  const text =
    sync === "loading"
      ? demo
        ? "Loading the demo…"
        : "Loading from the cloud…"
      : sync === "saving"
        ? "Saving…"
        : `${demo ? "Demo account · saved to the cloud" : "Saved to the cloud"}${syncedAt ? ` · checked ${ago(syncedAt, now)}` : ""}`;
  return (
    <p className={`sync sync-${sync}`} role="status" aria-live="polite">
      {text}
    </p>
  );
}
