import { useEffect, useRef, useState, type FormEvent } from "react";
import { GoogleMark } from "./GoogleMark";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isCode, normalizeCode } from "../family";
import { fetchMe } from "../lib/api";
import { afterSignIn, fromProfile, emailError, passwordError, writeSession, type HouseholdSession, type Role } from "../session";
import { authMessage, signInWithGoogle, signUpWithEmail } from "../lib/firebase";
import { Field } from "./Field";
import { AuthLayout } from "./AuthLayout";

const CONSENT_ERROR = "Tick the box to agree to what Saathi keeps.";

const roles: { id: Role; title: string; body: string }[] = [
  {
    id: "caretaker",
    title: "I’m caring for someone",
    body: "Set up Saathi for a parent or relative, and follow along from your own phone or computer.",
  },
  {
    id: "parent",
    title: "It’s for me",
    body: "Talk with Saathi. If your family sent you a family code, you add it next.",
  },
];

export function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Someone who opened a join link without an account: sign up as a parent, then join with that code.
  const linkCode = normalizeCode(params.get("code") ?? "");
  const codeParam = isCode(linkCode) ? linkCode : "";
  const summaryRef = useRef<HTMLDivElement>(null);
  const [role, setRole] = useState<Role | null>(codeParam ? "parent" : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [googleNote, setGoogleNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    document.title = "Create account · Saathi";
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role) return;
    setGoogleNote("");
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    const name = value("name");
    const parent = value("parent");
    const language = value("language") || "Hindi";
    const email = value("email");
    const password = String(data.get("password") ?? "");

    const next: Record<string, string> = {};
    if (!name) next.name = role === "parent" ? "Enter the name Saathi should call you." : "Enter your name.";
    if (role === "caretaker" && !parent) next.parent = "Enter the name Saathi should use.";
    const emailProblem = emailError(email);
    const passwordProblem = passwordError(password);
    if (emailProblem) next.email = emailProblem;
    if (passwordProblem) next.password = passwordProblem;
    if (!consent) next.consent = CONSENT_ERROR;
    setErrors(next);
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }

    setBusy(true);
    try {
      await signUpWithEmail(email, password);
    } catch (err) {
      setErrors({ email: authMessage(err) });
      requestAnimationFrame(() => summaryRef.current?.focus());
      setBusy(false);
      return;
    }
    setBusy(false);
    const session: HouseholdSession =
      role === "caretaker"
        ? { email, role, caretakerName: name, parentName: parent, language, consentAt: new Date().toISOString() }
        : { email, role, caretakerName: "", parentName: name, language, consentAt: new Date().toISOString() };
    writeSession(session);
    // A parent goes on to the join step: with the link's code filled in, or empty to enter or skip.
    navigate(role === "parent" && codeParam ? `/join/${codeParam}` : afterSignIn(session));
  }

  async function onGoogle() {
    if (!role) return;
    setGoogleNote("");
    if (!consent) {
      setErrors({ consent: CONSENT_ERROR });
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    try {
      const user = await signInWithGoogle();
      // An existing account keeps its role and names.
      const existing = await fetchMe().catch(() => null);
      if (existing) {
        const back = fromProfile({ ...existing, email: user.email });
        writeSession(back);
        navigate(afterSignIn(back));
        return;
      }
      const first = user.name.split(" ")[0] || user.name;
      const session: HouseholdSession =
        role === "caretaker"
          ? { email: user.email, role, caretakerName: first, parentName: "", language: "Hindi", consentAt: new Date().toISOString() }
          : { email: user.email, role, caretakerName: "", parentName: first, language: "Hindi", consentAt: new Date().toISOString() };
      writeSession(session);
      navigate(role === "parent" && codeParam ? `/join/${codeParam}` : afterSignIn(session));
    } catch (err) {
      setGoogleNote(authMessage(err));
      console.warn("Google sign-in failed", err);
    }
  }

  const lede = codeParam
    ? `Your family invited you with code ${codeParam}. Make your account, and the code is filled in for you.`
    : role === "parent"
      ? "Just a few details. Saathi uses your name when it says hello."
      : role === "caretaker"
        ? "Your name, and the name your parent likes to be called. Saathi uses it in the next conversation."
        : "First, who is this account for?";

  return (
    <AuthLayout
      eyebrow={codeParam ? "Family invite" : "New household"}
      title={codeParam ? "Join your family on Saathi" : "Create account"}
      lede={lede}
      aside={
        <>
          <img src="/photos/speaks.jpg" width="1152" height="864" alt="" />
          <h2>What happens next</h2>
          {role === "parent" ? (
            <ol className="auth-steps">
              <li>
                <strong>Make your account.</strong> Just your name, and the language Saathi speaks with you.
              </li>
              <li>
                <strong>Join your family.</strong> Enter the code they sent, or skip it and join later from the chat.
              </li>
              <li>
                <strong>Tap Talk.</strong> Saathi says hello first. There is nothing else to set up.
              </li>
            </ol>
          ) : (
          <ol className="auth-steps">
            <li>
              <strong>Create the caretaker account.</strong> Your name, your parent&rsquo;s preferred name, and the
              language.
            </li>
            <li>
              <strong>Share the family code.</strong> The care desk gives you a short code and a join link for your
              parent&rsquo;s phone.
            </li>
            <li>
              <strong>Your parent joins.</strong> They open the link on their phone, make their own account, and the
              code is already filled in. They can also skip it and join later from the chat.
            </li>
          </ol>
          )}
        </>
      }
    >
      {codeParam ? null : (
      <fieldset className="role-pick">
        <legend className="visually-hidden">Who is this account for?</legend>
        {roles.map((r) => (
          <label key={r.id} className={role === r.id ? "role-card role-card-on" : "role-card"}>
            <input
              type="radio"
              name="role"
              value={r.id}
              checked={role === r.id}
              onChange={() => {
                setRole(r.id);
                setErrors({});
              }}
            />
            <span className="role-mark" aria-hidden="true" />
            <span className="role-text">
              <strong>{r.title}</strong>
              <span>{r.body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      )}

      {role ? (
        <form key={role} className="stack" noValidate onSubmit={onSubmit}>
          {Object.keys(errors).length > 0 ? (
            <div className="error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
              <p>Fix these fields before creating the account.</p>
              <ul>
                {Object.entries(errors).map(([field, message]) => (
                  <li key={field}>
                    <a href={`#${field}`}>{message}</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {role === "caretaker" ? (
            <>
              <Field label="Your name" name="name" autoComplete="name" error={errors.name} />
              <Field
                label="Preferred name for your parent"
                name="parent"
                autoComplete="off"
                error={errors.parent}
              />
            </>
          ) : (
            <>
              <Field label="What should Saathi call you?" name="name" autoComplete="nickname" error={errors.name} />
            </>
          )}

          <label className="field" htmlFor="language">
            {role === "parent" ? "Language Saathi speaks with you" : "Language"}
            <select id="language" name="language" defaultValue="Hindi">
              <option value="Hindi">Hindi, spoken</option>
              <option value="English">English, text fallback</option>
            </select>
          </label>
          <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
          <Field label="Password" name="password" type="password" autoComplete="new-password" error={errors.password} />
          <div className="field">
            <label className="check" htmlFor="consent">
              <input
                id="consent"
                name="consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                aria-invalid={errors.consent ? true : undefined}
                aria-describedby={errors.consent ? "consent-error" : undefined}
              />
              <span>
                {role === "parent"
                  ? "I agree that Saathi keeps what I say in a conversation, to make the next one about my life. The words are deleted after 7 days. My family sees summaries, not a diagnosis."
                  : "I agree that Saathi keeps what I type and what my parent says in a conversation, to make the next one specific. The words are deleted after 7 days. My parent agrees when they join."}
              </span>
            </label>
            {errors.consent ? (
              <span className="field-error" id="consent-error">
                {errors.consent}
              </span>
            ) : null}
          </div>
          <div className="auth-actions">
            <button className="primary" type="submit" disabled={busy}>
              Create account
            </button>
            <p className="divider" aria-hidden="true">
              <span>or</span>
            </p>
            <button className="ghost google-button" type="button" onClick={onGoogle} disabled={busy}>
              <GoogleMark />
              Continue with Google
            </button>
          </div>
          {googleNote ? (
            <p className="field-error" role="status">
              {googleNote}
            </p>
          ) : null}
        </form>
      ) : null}

      {role === "parent" && !codeParam ? (
        <p className="note">Next, you can join your family with the code they sent, or skip it for now.</p>
      ) : null}
      <p className="auth-switch">
        Already have an account? <Link to={codeParam ? `/login?next=/join/${codeParam}` : "/login"}>Log in</Link>
      </p>
    </AuthLayout>
  );
}
