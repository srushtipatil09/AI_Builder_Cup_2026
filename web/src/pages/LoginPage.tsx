import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { GoogleMark } from "./GoogleMark";
import { emailError, findAccount, fromProfile, nextPath, passwordError, writeSession, type HouseholdSession } from "../session";
import { authMessage, signInWithEmail, signInWithGoogle } from "../lib/firebase";
import { fetchMe } from "../lib/api";
import { Field } from "./Field";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [googleNote, setGoogleNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Log in · Saathi";
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGoogleNote("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const next: Record<string, string> = {};
    const emailProblem = emailError(email);
    const passwordProblem = passwordError(password);
    if (emailProblem) next.email = emailProblem;
    if (passwordProblem) next.password = passwordProblem;
    setErrors(next);
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setBusy(true);
    try {
      const user = await signInWithEmail(email, password);
      await finish(user.email, user.name);
    } catch (err) {
      setErrors({ password: authMessage(err) });
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  // The role and names belong to the account, so they come from its stored profile.
  async function finish(email: string, displayName: string) {
    let session: HouseholdSession | null = null;
    try {
      const profile = await fetchMe();
      if (profile) session = fromProfile({ ...profile, email });
    } catch {
      // Offline: fall through to what this browser remembers.
    }
    session ??= findAccount(email) ?? {
      email,
      role: "caretaker",
      caretakerName: displayName.split(" ")[0] || displayName,
      parentName: "",
      language: "Hindi",
    };
    writeSession(session);
    navigate(nextPath(params, session));
  }

  async function onGoogle() {
    setGoogleNote("");
    setBusy(true);
    try {
      const user = await signInWithGoogle();
      await finish(user.email, user.name);
    } catch (err) {
      setGoogleNote(authMessage(err));
      console.warn("Google sign-in failed", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Log in"
      lede="Your account already knows whether you are a caretaker or using Saathi for yourself."
      aside={
        <>
          <img src="/photos/child.jpg" width="1152" height="864" alt="" />
          <h2>One household, two screens</h2>
          <ul className="auth-points">
            <li>
              <strong>On a computer, the care desk.</strong> Store the people who matter, the check-in time, and the
              memories the next conversation may use.
            </li>
            <li>
              <strong>On the parent&rsquo;s phone, the chat.</strong> At the agreed time a notification asks them to
              open Saathi. Saathi speaks after the app opens.
            </li>
          </ul>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={onSubmit}>
        {Object.keys(errors).length > 0 ? (
          <div className="error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
            <p>Fix these fields before logging in.</p>
            <ul>
              {Object.entries(errors).map(([name, message]) => (
                <li key={name}>
                  <a href={`#${name}`}>{message}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={errors.password}
        />
        <div className="auth-actions">
          <button className="primary" type="submit" disabled={busy}>
            Log in
          </button>
          <p className="divider" aria-hidden="true">
            <span>or</span>
          </p>
          <button
            className="ghost google-button"
            type="button"
            onClick={onGoogle}
            disabled={busy}
          >
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
      <p className="auth-switch">
        No account yet? <Link to={params.get("next")?.startsWith("/join/") ? `/signup?code=${params.get("next")!.slice(6)}` : "/signup"}>Create account</Link>
      </p>
    </AuthLayout>
  );
}
