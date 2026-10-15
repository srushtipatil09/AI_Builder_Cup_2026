import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { emailError, passwordError, writeSession } from "../session";
import { Field } from "./Field";
import { AuthLayout } from "./AuthLayout";

export function SignupPage() {
  const navigate = useNavigate();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [googleNote, setGoogleNote] = useState("");

  useEffect(() => {
    document.title = "Create account · Saathi";
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGoogleNote("");
    const data = new FormData(event.currentTarget);
    const caretakerName = String(data.get("caretaker") ?? "").trim();
    const parentName = String(data.get("parent") ?? "").trim();
    const language = String(data.get("language") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const next: Record<string, string> = {};
    if (!caretakerName) next.caretaker = "Enter your name.";
    if (!parentName) next.parent = "Enter the name Saathi should use.";
    if (!language) next.language = "Choose a language. Hindi is the one this build speaks.";
    const emailProblem = emailError(email);
    const passwordProblem = passwordError(password);
    if (emailProblem) next.email = emailProblem;
    if (passwordProblem) next.password = passwordProblem;
    setErrors(next);
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    writeSession({ email, caretakerName, parentName, language });
    navigate("/app");
  }

  return (
    <AuthLayout
      eyebrow="New household"
      title="Create account"
      lede="Name the household. Saathi uses the name the parent prefers in the next conversation."
      aside={
        <>
          <img src="/photos/speaks.jpg" width="1152" height="864" alt="" />
          <h2>What happens next</h2>
          <ol className="auth-steps">
            <li>
              <strong>Name the household.</strong> Signup asks only for your name, the parent&rsquo;s preferred name,
              and the language.
            </li>
            <li>
              <strong>Fill the care desk.</strong> Add the people who matter, a check-in time, and short memories. The
              next conversation may use them.
            </li>
            <li>
              <strong>Open Saathi on the parent&rsquo;s phone.</strong> Chrome can install it. On iPhone, use Share,
              then Add to Home Screen.
            </li>
          </ol>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={onSubmit}>
        {Object.keys(errors).length > 0 ? (
          <div className="error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
            <p>Fix these fields before creating the account.</p>
            <ul>
              {Object.entries(errors).map(([name, message]) => (
                <li key={name}>
                  <a href={`#${name}`}>{message}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Field label="Your name" name="caretaker" autoComplete="name" error={errors.caretaker} />
        <Field label="Preferred name for the parent" name="parent" autoComplete="nickname" error={errors.parent} />
        <label className="field" htmlFor="language">
          Language
          <select id="language" name="language" defaultValue="Hindi">
            <option value="Hindi">Hindi, spoken</option>
            <option value="English">English, text fallback</option>
          </select>
        </label>
        <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          error={errors.password}
        />
        <div className="auth-actions">
          <button className="primary" type="submit">
            Create account
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
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthLayout>
  );
}
