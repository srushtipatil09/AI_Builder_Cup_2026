import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FamilyMember } from "../../lib/api";
import { LanguageOptions } from "../../lib/languages";

type Props = {
  members: FamilyMember[];
  activeId: string;
  demo: boolean;
  loadError: string;
  onSwitch: (id: string) => void;
  onAdd: (name: string, language: string) => Promise<void>;
  onClose: () => void;
};

// A round picture of a person: a photo when there is one, their first letter, or a plain silhouette.
export function PersonAvatar({ name, src, className = "avatar" }: { name: string; src?: string | null; className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      {src ? (
        <img src={src} alt="" referrerPolicy="no-referrer" />
      ) : name ? (
        name.charAt(0).toUpperCase()
      ) : (
        <svg className="avatar-silhouette" viewBox="0 0 24 24">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />
        </svg>
      )}
    </span>
  );
}

function status(m: FamilyMember) {
  const parts = [m.phoneConnected ? "Phone connected" : "Phone not connected yet"];
  if (m.urgentAlerts) parts.push(`${m.urgentAlerts} need${m.urgentAlerts === 1 ? "s" : ""} attention`);
  else if (m.openAlerts) parts.push(`${m.openAlerts} new update${m.openAlerts === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

// Every family member this caretaker looks after: switch between their desks, see who needs attention, add one.
export function FamilySwitcher({ members, activeId, demo, loadError, onSwitch, onAdd, onClose }: Props) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (panel.current?.querySelector<HTMLElement>("[aria-current='true']") ?? panel.current?.querySelector<HTMLElement>("button"))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("member-name") ?? "").trim();
    if (!name) {
      setError("Enter the name Saathi should use.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAdd(name, String(data.get("member-language") ?? "Hindi"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that family member. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop members-backdrop" onClick={onClose}>
      <div
        ref={panel}
        className="join-sheet members-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="members-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="members-head">
          <h2 id="members-title">Family members</h2>
          <button className="text-link members-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p>Each person has their own desk, phone, memories, and reminders. Pick one to open it.</p>

        {loadError ? (
          <p className="field-error" role="alert">
            {loadError}
          </p>
        ) : null}

        <ul className="members-list">
          {members.map((m) => {
            const current = m.id === activeId;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className={current ? "member member-on" : "member"}
                  aria-current={current ? "true" : undefined}
                  onClick={() => (current ? onClose() : onSwitch(m.id))}
                >
                  <PersonAvatar name={m.parentName} src={m.photo} />
                  <span className="member-text">
                    <strong>{m.parentName || "Name not set"}</strong>
                    <span>{[m.city, m.language].filter(Boolean).join(" · ")}</span>
                    <span className={m.urgentAlerts ? "member-status member-status-alert" : "member-status"}>{status(m)}</span>
                  </span>
                  {current ? <span className="member-badge">Current</span> : null}
                </button>
              </li>
            );
          })}
        </ul>

        {demo ? (
          <p className="note">The demo has one synthetic family member. Create an account to add your own.</p>
        ) : adding ? (
          <form className="members-add" onSubmit={(e) => void submit(e)} noValidate>
            <label className="field" htmlFor="member-name">
              What should Saathi call them?
              <input id="member-name" name="member-name" autoComplete="off" maxLength={60} autoFocus aria-invalid={error ? true : undefined} />
            </label>
            <label className="field" htmlFor="member-language">
              Language
              <select id="member-language" name="member-language" defaultValue="Hindi">
                <LanguageOptions />
              </select>
            </label>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="members-add-actions">
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add and open"}
              </button>
              <button className="ghost" type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="ghost members-add-open" type="button" onClick={() => setAdding(true)}>
            + Add a family member
          </button>
        )}
      </div>
    </div>
  );
}
