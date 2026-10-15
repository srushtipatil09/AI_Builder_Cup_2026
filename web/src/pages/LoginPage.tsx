import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { emailError, passwordError, writeSession } from "../session";
import { Field } from "./Field";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const navigate = useNavigate();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [googleNote, setGoogleNote] = useState("");

  useEffect(() => {
    document.title = "Log in · Saathi";
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
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
    writeSession({ email, caretakerName: "", parentName: "", language: "Hindi" });
    navigate("/app");
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Log in"
      lede="The caretaker signs in. The parent should not have to fill a form to start the day."
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
          <button className="primary" type="submit">
            Log in
          </button>
          <p className="divider" aria-hidden="true">
            <span>or</span>
          </p>
          <button
            className="ghost"
            type="button"
            onClick={() => setGoogleNote("Google sign-in is not connected in this build.")}
          >
            Continue with Google
          </button>
        </div>
        {googleNote ? (
          <p className="field-error" role="status">
            {googleNote}
          </p>
        ) : null}
      </form>
      <p className="note">This build keeps the session in this browser. Cloud sign-in is not connected yet.</p>
      <p className="auth-switch">
        No account yet? <Link to="/signup">Create account</Link>
      </p>
    </AuthLayout>
  );
}
