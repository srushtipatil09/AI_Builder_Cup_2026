import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isPhoneEntry } from "../phoneEntry";
import { clearSession, readSession } from "../session";
import { CareDesk } from "./CareDesk";
import { CompanionChat } from "./CompanionChat";

type Health = { service: string; status: string; stage: string };

export function AppShell() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const demo = params.get("demo") === "1";
  const session = readSession();
  const [showDeskOnPhone, setShowDeskOnPhone] = useState(false);
  const [health, setHealth] = useState("Checking the API…");

  useEffect(() => {
    document.title = demo ? "Kamla Sharma · Saathi" : "Talk · Saathi";
  }, [demo]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<Health>;
      })
      .then((body) => setHealth(`${body.service} is ${body.status} (${body.stage})`))
      .catch(() => setHealth("API is not running. Start it on port 8080."));
    return () => controller.abort();
  }, []);

  function leave() {
    if (!demo) clearSession();
    navigate(isPhoneEntry() ? "/login" : "/");
  }

  const title = demo ? "Kamla Sharma" : session?.parentName || "Your household";
  const detail = demo
    ? "Synthetic household. Kamla is 78 and lives in Varanasi."
    : session?.email
      ? `Signed in as ${session.email}`
      : "Household";
  const healthy = health.startsWith("saathi-api");
  const checking = health.startsWith("Checking");

  return (
    <div className={showDeskOnPhone ? "app app-desk-open" : "app"}>
      <header className="app-bar">
        <div className="app-bar-inner">
          <Link className="brand" to="/" lang="hi">
            साथी
          </Link>
          <div className="app-who">
            <span className="avatar" aria-hidden="true">
              {title.charAt(0)}
            </span>
            <div>
              <p className="who-name">{title}</p>
              <p className="who">{detail}</p>
            </div>
          </div>
          <button
            className="text-link phone-toggle"
            type="button"
            aria-pressed={showDeskOnPhone}
            onClick={() => setShowDeskOnPhone((value) => !value)}
          >
            {showDeskOnPhone ? "Back to chat" : "Care desk"}
          </button>
          <button className="text-link leave-wide" type="button" onClick={leave}>
            {demo ? "Leave demo" : "Log out"}
          </button>
        </div>
      </header>
      <main className={showDeskOnPhone ? "page force-desk" : "page"}>
        <div className="status-row">
          <p role="status" className={healthy ? "pill pill-ok" : checking ? "pill" : "pill pill-wait"}>
            <span className="pill-dot" aria-hidden="true" />
            {health}
          </p>
          <p className="note">Voice, memory, and alerts are not connected yet.</p>
        </div>
        <CareDesk demo={demo} parentName={session?.parentName} language={session?.language} />
        <CompanionChat demo={demo} name={demo ? "Kamla" : session?.parentName} />
        <p className="leave-phone">
          <button className="text-link" type="button" onClick={leave}>
            {demo ? "Leave demo" : "Log out"}
          </button>
        </p>
      </main>
    </div>
  );
}
