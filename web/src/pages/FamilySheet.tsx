import { useEffect, useState } from "react";
import { findByCode } from "../family";
import type { HouseholdSession } from "../session";
import { JoinForm } from "./JoinForm";

type Props = {
  session: HouseholdSession;
  demo: boolean;
  onClose: () => void;
  onJoined: (session: HouseholdSession) => void;
};

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

// The parent's Family window: join a family, or see the one you joined and change its code.
export function FamilySheet({ session, demo, onClose, onJoined }: Props) {
  const joined = Boolean(session.familyCode);
  const [changing, setChanging] = useState(!joined);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const link = session.familyCode ? findByCode(session.familyCode) : null;
  const family = session.caretakerName ? `${session.caretakerName}’s family` : "your family";
  const title = !joined ? "Join your family" : changing ? "Change family code" : "Your family";

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="join-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="family-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="family-sheet-head">
          <h2 id="family-sheet-title">{title}</h2>
          {demo ? <span className="tag">Demo</span> : null}
        </div>

        {changing ? (
          <>
            <p>
              {joined
                ? `Enter the new code ${session.caretakerName || "your family"} sent you. The old one stops linking this phone.`
                : "Enter the family code your family sent you. Saathi then knows the people and memories they add."}
            </p>
            <JoinForm
              session={session}
              persist={!demo}
              submitLabel={joined ? "Use this code" : "Join my family"}
              skipLabel={joined ? "Cancel" : "Not now"}
              onSkip={joined ? () => setChanging(false) : onClose}
              onJoined={(next) => {
                onJoined(next);
                setChanging(false);
              }}
              autoFocus
            />
          </>
        ) : (
          <>
            <p>You are part of {family}. Saathi uses the people and memories they add.</p>
            <dl className="family-facts">
              <div>
                <dt>Family code</dt>
                <dd className="family-facts-code">{session.familyCode}</dd>
              </div>
              {session.caretakerName ? (
                <div>
                  <dt>Looked after by</dt>
                  <dd>{session.caretakerName}</dd>
                </div>
              ) : null}
              {link?.joinedAt ? (
                <div>
                  <dt>Joined</dt>
                  <dd>{formatDay(link.joinedAt)}</dd>
                </div>
              ) : null}
            </dl>
            {demo ? <p className="family-demo">Demo household. Changes here are not saved.</p> : null}
            <div className="auth-actions">
              <button className="primary" type="button" onClick={() => setChanging(true)}>
                Change code
              </button>
              <button className="ghost" type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
