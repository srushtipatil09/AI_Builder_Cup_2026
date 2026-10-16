import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMedia } from "../health";
import { isPhoneEntry } from "../phoneEntry";
import { clearSession, readSession, type HouseholdSession } from "../session";
import { FamilySheet } from "./FamilySheet";
import { CompanionChat } from "./CompanionChat";

// Kamla's synthetic family, for the demo only.
function demoFamily(): HouseholdSession {
  return { email: "", role: "parent", caretakerName: "Rahul", parentName: "Kamla", language: "Hindi", familyCode: "KMR-4F7" };
}

// The parent's screen. The route sends a caretaker's own account to the care desk instead.
export function AppShell() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const demo = params.get("demo") === "1";
  const [session, setSession] = useState(readSession);
  // The demo's family lives only in memory, so trying Change code never touches a real account.
  const [demoSession, setDemoSession] = useState<HouseholdSession>(demoFamily);
  const [familyOpen, setFamilyOpen] = useState(false);
  const wide = useMedia("(min-width: 1024px)");
  const parent = demo ? demoSession : session?.role === "parent" ? session : null;
  const joined = Boolean(parent?.familyCode);

  useEffect(() => {
    document.title = demo ? "Kamla Sharma · Saathi" : "Talk · Saathi";
  }, [demo]);

  function leave() {
    if (!demo) clearSession();
    navigate(isPhoneEntry() ? "/login" : "/");
  }

  const title = demo ? "Kamla" : session?.parentName || "Your household";
  const detail = demo
    ? "Kamla Sharma, 78 · synthetic household"
    : parent?.familyCode
      ? parent.caretakerName
        ? `With ${parent.caretakerName}’s family`
        : "Joined your family"
      : "Saathi";

  const phone = (
    <div className="app">
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="app-who">
            <span className="avatar" aria-hidden="true">
              {title.charAt(0)}
            </span>
            <div>
              <p className="who-name">{title}</p>
              <p className="who">{detail}</p>
            </div>
          </div>
          {parent ? (
            <button
              className={joined ? "family-button" : "family-button family-button-join"}
              type="button"
              onClick={() => setFamilyOpen(true)}
              aria-haspopup="dialog"
              aria-label={joined ? "Family: see or change your family code" : "Family: join your family"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1.5-9a3 3 0 1 0 0-6M21 20a5 5 0 0 0-3.5-4.8" />
              </svg>
              Family
            </button>
          ) : null}
          <button className="text-link leave" type="button" onClick={leave} aria-label={demo ? "Leave demo" : undefined}>
            {demo ? "Leave" : "Log out"}
          </button>
        </div>
      </header>
      <main className="page">
        <CompanionChat demo={demo} name={demo ? "Kamla" : session?.parentName} />
      </main>
      {familyOpen && parent ? (
        <FamilySheet
          session={parent}
          demo={demo}
          onClose={() => setFamilyOpen(false)}
          onJoined={(next) => (demo ? setDemoSession(next) : setSession(next))}
        />
      ) : null}
    </div>
  );

  if (!wide) return phone;

  // A parent using a computer sees the same phone screen, centred.
  if (!demo) {
    return (
      <div className="stage stage-solo">
        <div className="device">{phone}</div>
      </div>
    );
  }

  // On a computer, the parent demo shows Kamla's phone in a frame.
  return (
    <div className="stage">
      <div className="stage-copy">
        <Link className="brand" to="/" lang="hi">
          साथी
        </Link>
        <p className="eyebrow">Parent demo</p>
        <h1>Kamla&rsquo;s phone</h1>
        <p>
          This is all Kamla sees. Saathi speaks first, and there are four large buttons. Nothing to set up and no
          menus.
        </p>
        <p className="stage-note">Synthetic household. Voice is not connected in this build.</p>
        <div className="stage-links">
          <Link className="button" to="/care?demo=1">
            See Rahul&rsquo;s caretaker app
          </Link>
          <Link className="text-link" to="/">
            Back to home
          </Link>
        </div>
      </div>
      <div className="device">{phone}</div>
    </div>
  );
}
