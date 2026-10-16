import { useState, type FormEvent } from "react";
import { cacheLink, findByCode, isCode, markJoined, normalizeCode } from "../family";
import { lookupFamilyCode } from "../lib/api";
import { writeSession, type HouseholdSession } from "../session";

type Props = {
  session: HouseholdSession;
  initialCode?: string;
  onJoined: (session: HouseholdSession) => void;
  // "Skip for now" on the page after sign-in, "Not now" in the chat's sheet.
  onSkip: () => void;
  skipLabel: string;
  submitLabel?: string;
  autoFocus?: boolean;
  // The demo shows the flow without saving a real session.
  persist?: boolean;
};

// Links a parent's account to the caretaker's household. The name and language come from the account,
// so the only thing to enter is the code.
export function JoinForm({
  session,
  initialCode = "",
  onJoined,
  onSkip,
  skipLabel,
  submitLabel = "Join my family",
  autoFocus,
  persist = true,
}: Props) {
  const [code, setCode] = useState(normalizeCode(initialCode));
  const [error, setError] = useState("");
  const link = isCode(code) ? findByCode(code) : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCode(code)) {
      setError("Enter the family code, like ABC-123. Your family can read it to you.");
      return;
    }
    let found = findByCode(code);
    if (!found) {
      try {
        found = await lookupFamilyCode(normalizeCode(code));
        cacheLink(found);
      } catch {
        setError("We could not find that code. Check it with your family and try again.");
        return;
      }
    }
    if (persist) {
      try {
        await markJoined(code, session.parentName);
      } catch {
        setError("We could not reach Saathi to finish joining. Check the connection and try again.");
        return;
      }
    }
    const next: HouseholdSession = {
      ...session,
      familyCode: code,
      caretakerName: found?.caretakerName || session.caretakerName,
      joinSkipped: false,
    };
    if (persist) writeSession(next);
    onJoined(next);
  }

  return (
    <form className="stack join-form" noValidate onSubmit={onSubmit}>
      <label className="field" htmlFor="code">
        Family code
        <input
          id="code"
          name="code"
          className="code-input"
          value={code}
          onChange={(event) => {
            setCode(normalizeCode(event.target.value));
            setError("");
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={7}
          placeholder="ABC-123"
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "code-error" : undefined}
        />
        {error ? (
          <span id="code-error" className="field-error" role="alert">
            {error}
          </span>
        ) : null}
        {link ? (
          <span className="code-found">
            Found {link.caretakerName ? `${link.caretakerName}’s` : "your family’s"} code.
          </span>
        ) : null}
      </label>
      <div className="auth-actions">
        <button className="primary join-go" type="submit">
          {submitLabel}
        </button>
        <button className="ghost" type="button" onClick={onSkip}>
          {skipLabel}
        </button>
      </div>
    </form>
  );
}
