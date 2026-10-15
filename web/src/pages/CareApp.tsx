import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { blankDesk, demoDesk, formatClock, formatQuiet, today, useDesk, type Desk } from "../desk";
import { useFamilyLink } from "../family";
import { useHealth } from "../health";
import { householdKey, readSession } from "../session";
import { DailyTab } from "./desk/DailyTab";
import { EmergencyTab } from "./desk/EmergencyTab";
import { FamilyCard } from "./desk/FamilyCard";
import { MedicineTab } from "./desk/MedicineTab";
import { ProfileTab } from "./desk/ProfileTab";
import { TellSaathiTab } from "./desk/TellSaathiTab";

type Props = {
  demo: boolean;
  onLeave: () => void;
};

const tabs = [
  { id: "profile", label: "Profile", hint: "The person, people, memories" },
  { id: "routine", label: "Routine", hint: "Meals, mood, time talking" },
  { id: "ask", label: "Ask Saathi", hint: "Type or speak a change" },
  { id: "reminders", label: "Reminders", hint: "Medicines, as written" },
  { id: "contacts", label: "Trusted Contacts", hint: "Who to call, and 112" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const TAB_KEY = "saathi.desk.tab";

function readTab(): TabId {
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    return tabs.some((t) => t.id === saved) ? (saved as TabId) : "profile";
  } catch {
    return "profile";
  }
}

function TabIcon({ id }: { id: TabId }) {
  const paths: Record<TabId, string> = {
    profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
    routine: "M4 20V10m6 10V4m6 16v-7m4 7H2",
    ask: "M4 5h16v11H9l-5 4V5Zm4 5h.01M12 10h.01M16 10h.01",
    reminders: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2Zm4 4h4",
    contacts: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1.5-9a3 3 0 1 0 0-6M21 20a5 5 0 0 0-3.5-4.8",
  };
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[id]} />
    </svg>
  );
}

function Avatar({ name, photo }: { name: string; photo: boolean }) {
  return (
    <span className="avatar" aria-hidden="true">
      {photo ? <img src="/photos/hero.jpg" width="864" height="1152" alt="" /> : (name || "?").charAt(0)}
    </span>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function subtitle(id: TabId, who: string) {
  switch (id) {
    case "profile":
      return `Who ${who} is, and what Saathi may talk about.`;
    case "routine":
      return `What ${who} shared over the last 14 days. There is no health score.`;
    case "ask":
      return "Type or speak a change, the way you would tell a person.";
    case "reminders":
      return "Medicine reminders, read back exactly as you typed them.";
    case "contacts":
      return `Who Saathi tells when ${who} needs help.`;
  }
}

type Step = { done: boolean; text: string; tab: TabId; anchor: string };

function setupSteps(desk: Desk, joined: boolean, who: string): Step[] {
  return [
    { done: joined, text: `Connect ${who}’s phone`, tab: "profile", anchor: "family-title" },
    { done: Boolean(desk.profile.checkIn), text: "Set a daily check-in time", tab: "profile", anchor: "person-title" },
    { done: desk.people.length > 0, text: "Add someone who matters", tab: "profile", anchor: "people-title" },
    { done: desk.memories.length > 0, text: "Add one memory Saathi can mention", tab: "profile", anchor: "memories-title" },
    { done: desk.contacts.some((c) => c.local), text: "Add a trusted contact who lives nearby", tab: "contacts", anchor: "contacts-title" },
  ];
}

export function CareApp({ demo, onLeave }: Props) {
  const session = readSession();
  const health = useHealth();
  const caretaker = demo ? "Rahul" : session?.caretakerName || "";
  const storageKey = demo ? "saathi.desk.demo.v2" : householdKey(session);
  const { desk, setDesk, reset } = useDesk(storageKey, () =>
    demo ? demoDesk() : blankDesk(session?.parentName ?? "", session?.language ?? "Hindi"),
  );
  const [active, setActive] = useState<TabId>(readTab);
  // Forms use default values, so a reset remounts them.
  const [version, setVersion] = useState(0);
  // On Ask Saathi the right rail holds that tab's guide, which the tab renders into this slot.
  const [guideSlot, setGuideSlot] = useState<HTMLElement | null>(null);
  const name = desk.profile.preferredName;
  const who = name || "your parent";
  const author = caretaker || "You";
  const family = useFamilyLink(demo ? "demo" : storageKey, name, caretaker);

  useEffect(() => {
    document.title = demo ? "Caretaker demo · Saathi" : "Care desk · Saathi";
  }, [demo]);

  function choose(id: TabId) {
    setActive(id);
    window.scrollTo({ top: 0 });
    document.querySelector(".care-main")?.scrollTo({ top: 0 });
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      // The tab simply resets next visit.
    }
  }

  // Arrow keys move between tabs, as in a native tab list.
  function onKey(event: React.KeyboardEvent, index: number, prefix: string) {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !back) return;
    event.preventDefault();
    const next = tabs[(index + (forward ? 1 : -1) + tabs.length) % tabs.length];
    choose(next.id);
    document.getElementById(`${prefix}-${next.id}`)?.focus();
  }

  function renderTabs(prefix: string, className: string, compact: boolean) {
    return tabs.map((tab, index) => (
      <button
        key={tab.id}
        id={`${prefix}-${tab.id}`}
        role="tab"
        type="button"
        aria-selected={active === tab.id}
        aria-controls="care-panel"
        tabIndex={active === tab.id ? 0 : -1}
        className={className}
        onClick={() => choose(tab.id)}
        onKeyDown={(event) => onKey(event, index, prefix)}
      >
        <TabIcon id={tab.id} />
        {compact ? (
          <span className="tabbar-label">{tab.label}</span>
        ) : (
          <span>
            <strong>{tab.label}</strong>
            <small>{tab.hint}</small>
          </span>
        )}
      </button>
    ));
  }

  const current = tabs.find((t) => t.id === active)!;
  const steps = setupSteps(desk, Boolean(family.link?.joinedAt), who);
  const doneCount = steps.filter((s) => s.done).length;
  const healthClass = health.tone === "ok" ? "pill pill-ok" : health.tone === "wait" ? "pill pill-wait" : "pill";

  return (
    <div className={`care care-tab-${active}`}>
      <aside className="care-side">
        <div className="care-brand">
          <Link className="brand" to="/" lang="hi">
            साथी
          </Link>
          <span className="care-badge">Caretaker</span>
        </div>

        <div className="care-parent">
          <Avatar name={name} photo={demo} />
          <div>
            <p className="care-parent-name">{name || "Your parent"}</p>
            <p className="care-parent-meta">
              {[desk.profile.city, desk.profile.language].filter(Boolean).join(" · ") || "Profile not finished"}
            </p>
          </div>
        </div>
        {demo ? <p className="tag care-tag">Synthetic demo household</p> : null}

        <div className="care-side-tabs" role="tablist" aria-orientation="vertical" aria-label="Care desk sections">
          {renderTabs("tab", "desk-tab", false)}
        </div>

        <div className="care-side-foot">
          <p role="status" className={healthClass}>
            <span className="pill-dot" aria-hidden="true" />
            {health.text}
          </p>
          <p>Saved in this browser. Cloud sync is not connected yet.</p>
          <div className="care-side-actions">
            {demo ? (
              <button
                className="text-link"
                type="button"
                onClick={() => {
                  reset();
                  setVersion((v) => v + 1);
                }}
              >
                Reset demo data
              </button>
            ) : null}
            <button className="text-link" type="button" onClick={onLeave}>
              {demo ? "Leave demo" : "Log out"}
            </button>
          </div>
        </div>
      </aside>

      <header className="care-mbar">
        <Avatar name={name} photo={demo} />
        <div className="care-mbar-text">
          <p className="care-mbar-title">Caring for {name || "your parent"}</p>
          <p className="care-mbar-sub">{demo ? "Caretaker demo · synthetic household" : caretaker || "Caretaker"}</p>
        </div>
        <button className="text-link" type="button" onClick={onLeave}>
          {demo ? "Leave" : "Log out"}
        </button>
      </header>

      <main id="care-panel" className="care-main" role="tabpanel" aria-labelledby={`tab-${active}`}>
        <header className="care-head">
          <p className="care-greet">
            {greeting()}
            {caretaker ? `, ${caretaker}` : ""}
            <span className="care-date">
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </span>
          </p>
          <h1>{current.label}</h1>
          <p className="care-sub">{subtitle(active, who)}</p>
        </header>

        {active === "profile" && doneCount < steps.length ? (
          <section className="setup" aria-labelledby="setup-title">
            <div className="setup-top">
              <h2 id="setup-title">Finish setting up</h2>
              <span className="setup-count">
                {doneCount} of {steps.length} done
              </span>
            </div>
            <div className="setup-bar" aria-hidden="true">
              <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <ul>
              {steps.map((step) => (
                <li key={step.text} className={step.done ? "setup-done" : undefined}>
                  {step.done ? (
                    <span>
                      <span className="setup-mark" aria-hidden="true" />
                      {step.text}
                      <span className="visually-hidden"> (done)</span>
                    </span>
                  ) : step.tab === active ? (
                    <a href={`#${step.anchor}`}>
                      <span className="setup-mark" aria-hidden="true" />
                      {step.text}
                    </a>
                  ) : (
                    <button type="button" onClick={() => choose(step.tab)}>
                      <span className="setup-mark" aria-hidden="true" />
                      {step.text}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {active === "profile" ? (
          <>
            <FamilyCard link={family.link} name={name} demo={demo} onCreate={family.create} />
            <ProfileTab key={version} desk={desk} setDesk={setDesk} author={author} />
          </>
        ) : null}
        {active === "routine" ? <DailyTab
            demo={demo}
            name={name}
            medicines={desk.medicines}
            onOpenReminders={() => choose("reminders")}
            onConfirmReminder={(id) =>
              setDesk((d) => ({
                ...d,
                medicines: d.medicines.map((m) => (m.id === id ? { ...m, confirmedOn: today(), confirmedBy: author } : m)),
              }))
            }
          /> : null}
        {active === "ask" ? <TellSaathiTab desk={desk} setDesk={setDesk} author={author} name={name} guideSlot={guideSlot} /> : null}
        {active === "reminders" ? <MedicineTab desk={desk} setDesk={setDesk} name={name} author={author} /> : null}
        {active === "contacts" ? <EmergencyTab desk={desk} setDesk={setDesk} name={name} /> : null}
      </main>

      {active === "ask" ? (
        <aside className="care-rail" aria-label="How to use Ask Saathi" ref={setGuideSlot} />
      ) : (
        <aside className="care-rail" aria-label={`${who} at a glance`}>
          <section className="rail-card" aria-labelledby="glance-title">
            <h2 id="glance-title">At a glance</h2>
            <dl className="glance">
              <div>
                <dt>Phone connected</dt>
              <dd>{family.link?.joinedAt ? "Yes" : "Not yet"}</dd>
            </div>
            <div>
              <dt>Persona</dt>
                <dd>{desk.profile.persona}</dd>
              </div>
              <div>
                <dt>Daily check-in</dt>
                <dd>{formatClock(desk.profile.checkIn)}</dd>
              </div>
              <div>
                <dt>Quiet hours</dt>
                <dd>{formatQuiet(desk.profile.quietHours)}</dd>
              </div>
              <div>
                <dt>People who matter</dt>
                <dd>
                  <button type="button" className="glance-link" onClick={() => choose("profile")}>
                    {desk.people.length}
                  </button>
                </dd>
              </div>
              <div>
                <dt>Reminders</dt>
                <dd>
                  <button type="button" className="glance-link" onClick={() => choose("reminders")}>
                    {desk.medicines.length}
                  </button>
                </dd>
              </div>
              <div>
                <dt>Trusted contacts</dt>
                <dd>
                  <button type="button" className="glance-link" onClick={() => choose("contacts")}>
                    {desk.contacts.length}
                  </button>
                </dd>
              </div>
            </dl>
          </section>

          {demo ? (
            <section className="rail-card rail-alert" aria-labelledby="rail-family">
              <h2 id="rail-family">Mentions of Rahul changed</h2>
              <p>Day 2 and Day 12 tell different stories. A call is a reasonable next step.</p>
              <button type="button" className="text-link" onClick={() => choose("routine")}>
                See both quotes
              </button>
            </section>
          ) : null}

          {/* A signed-in caretaker on a wide window is sent back here from /app, so only the demo links out. */}
          {demo ? (
            <section className="rail-card rail-phone">
              <h2>{name ? `${name}\u2019s phone` : "The parent\u2019s phone"}</h2>
              <p>One screen, four large buttons. Saathi speaks first.</p>
              <Link className="ghost" to="/app?demo=1">
                Preview the phone
              </Link>
            </section>
          ) : null}
        </aside>
      )}

      <nav
        className="care-tabbar"
        aria-label="Care desk sections"
        data-edge={active === tabs[0].id ? "start" : active === tabs[tabs.length - 1].id ? "end" : undefined}
        style={{ "--tab": tabs.findIndex((t) => t.id === active) } as React.CSSProperties}
      >
        <span className="tabbar-notch" aria-hidden="true">
          <svg viewBox="0 0 120 30" preserveAspectRatio="none">
            <path d="M0 30C26 30 28 2 60 2s34 28 60 28Z" />
          </svg>
          <span className="tabbar-orb" />
        </span>
        <div role="tablist" aria-label="Care desk sections">
          {renderTabs("btab", "care-tabbar-item", true)}
        </div>
      </nav>
    </div>
  );
}
