import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { afterSignIn, readSession, writeSession } from "../session";
import { AuthLayout } from "./AuthLayout";
import { LanguageOptions } from "../lib/languages";

// Shown once after a Google sign-up. Google gives a name and an email; Saathi also needs who it will talk with,
// their language, and the city, so that nearby help works before a phone shares its position.
export function DetailsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const session = readSession();
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "A few details · Saathi";
  }, []);

  if (!session) return null;
  const parent = session.role === "parent";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    const name = value("name");
    const parentName = value("parent");
    if (!name) return setError(parent ? "Enter the name Saathi should call you." : "Enter your name.");
    if (!parent && !parentName) return setError("Enter the name Saathi should use for your parent.");
    const next = parent
      ? { ...session, parentName: name, language: value("language") || "Hindi", city: value("city"), detailsPending: false }
      : { ...session, caretakerName: name, parentName, language: value("language") || "Hindi", city: value("city"), detailsPending: false };
    writeSession(next);
    const then = params.get("then") ?? "";
    navigate(parent && /^\/join\/[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(then) ? then : afterSignIn(next), { replace: true });
  }

  return (
    <AuthLayout
      demoLinks={false}
      eyebrow="One more step"
      title="A few details"
      lede={
        parent
          ? "Saathi uses your name when it says hello, and your city to find a hospital, a park, or a trusted person near you."
          : "Saathi uses these to greet your parent, speak their language, and find help near where they live."
      }
      aside={
        <>
          <img src="/photos/speaks.jpg" width="1152" height="864" alt="" />
          <h2>Why we ask</h2>
          <ul className="auth-points">
            <li>
              <strong>The name.</strong> Saathi says hello the way your family does.
            </li>
            <li>
              <strong>The city.</strong> When your parent asks for a hospital, a park or something to eat, Saathi looks
              in their city. Their phone can also share its position, once, if they allow it.
            </li>
          </ul>
        </>
      }
    >
      <form className="stack" noValidate onSubmit={onSubmit}>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          {parent ? "What should Saathi call you?" : "Your name"}
          <input name="name" autoComplete="name" defaultValue={parent ? session.parentName : session.caretakerName} />
        </label>
        {parent ? null : (
          <label className="field">
            Preferred name for your parent
            <input name="parent" autoComplete="off" defaultValue={session.parentName} />
          </label>
        )}
        <label className="field">
          {parent ? "Language Saathi speaks with you" : "Language"}
          <select name="language" defaultValue={session.language || "Hindi"}>
            <LanguageOptions />
          </select>
        </label>
        <label className="field">
          {parent ? "Your city" : "City where your parent lives"} <span className="optional">(optional)</span>
          <input name="city" autoComplete="address-level2" defaultValue={session.city} placeholder="e.g. Varanasi" />
        </label>
        <div className="auth-actions">
          <button className="primary" type="submit">
            Continue
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
