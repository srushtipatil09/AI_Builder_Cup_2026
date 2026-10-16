import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { readSession, writeSession } from "../session";
import { AuthLayout } from "./AuthLayout";
import { JoinForm } from "./JoinForm";

// Shown once after a parent signs up or logs in, until they join or skip. The chat keeps a Join family button.
export function JoinPage() {
  const navigate = useNavigate();
  const { code = "" } = useParams();
  const session = readSession();

  useEffect(() => {
    document.title = "Join your family · Saathi";
  }, []);

  if (!session) return null;
  const name = session.parentName;

  return (
    <AuthLayout
      demoLinks={false}
      eyebrow="One more step"
      title="Join your family"
      lede={`${name ? `Hello, ${name}. ` : ""}If your family sent you a family code, enter it here. You can also do this later from the chat.`}
      aside={
        <>
          <img src="/photos/hero.jpg" width="864" height="1152" alt="" className="join-photo" />
          <h2>Why join?</h2>
          <ul className="auth-points">
            <li>
              <strong>Saathi knows your family.</strong> The people and memories your family adds come up when you
              talk.
            </li>
            <li>
              <strong>Your family hears what matters.</strong> If you ask for help, the people you trust are told.
            </li>
          </ul>
        </>
      }
    >
      <JoinForm
        session={session}
        initialCode={code}
        onJoined={() => navigate("/app", { replace: true })}
        onSkip={() => {
          writeSession({ ...session, joinSkipped: true });
          navigate("/app", { replace: true });
        }}
        skipLabel="Skip for now"
      />
      <p className="note">
        Your family can read the code from their care desk. If it is not found, skip for now and join later from the
        chat.
      </p>
    </AuthLayout>
  );
}
