import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { blankDesk, demoDesk, formatClock, formatQuiet, useDesk, type Desk } from "../desk";
import { useFamilyLink } from "../family";
import { useMedia } from "../health";
import { activeHouseholdId, readSession, writeSession, type HouseholdSession } from "../session";
import { addFamilyMember, type FamilyMember } from "../lib/api";
import { useAppDispatch, useAppSelector } from "../store";
import { loadMembers as loadMembersThunk, memberAdded } from "../store/reads";
import { useAccountPhoto } from "../lib/firebase";
import { FamilySwitcher, PersonAvatar } from "./desk/FamilySwitcher";
import { RoutineTab } from "./desk/RoutineTab";
import { useUpdates } from "../lib/useUpdates";
import { SyncStatus } from "./SyncStatus";
import { DocumentsCard, useProfilePhoto } from "./desk/DocumentsCard";
import { EmergencyTab } from "./desk/EmergencyTab";
import { FamilyCard } from "./desk/FamilyCard";
import { MedicineTab } from "./desk/MedicineTab";
import { ProfileTab } from "./desk/ProfileTab";
import { TellSaathiTab } from "./desk/TellSaathiTab";
import { UndoContext } from "./desk/undo";
import { InstallSheet } from "./InstallSheet";

type Props = {
  demo: boolean;
  onLeave: () => void;
};

type DeskProps = Props & {
  session: HouseholdSession | null;
  householdId: string;
  seedName: string;
  seedLanguage: string;
  seedCity: string;
  memberCount: number;
  accountPhoto: string | null;
  onOpenMembers: () => void;
};

const tabs = [
  { id: "profile", label: "Profile", hint: "The person, people, memories" },
  { id: "routine", label: "Routine", hint: "Meals, mood, time talking" },
  { id: "ask", label: "Ask Saathi", short: "Ask", hint: "Type or speak a change" },
  { id: "reminders", label: "Reminders", hint: "Medicine, walks, calls, meals" },
  { id: "contacts", label: "Trusted Contacts", short: "Contacts", hint: "Who to call, and 112" },
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
      return "Reminders for medicine, a walk, a call or a meal, read back exactly as you typed them.";
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

const DEMO_PHOTO = "/photos/hero.jpg";

const DEMO_MEMBERS: FamilyMember[] = [
  { id: "demo-kamla-sharma", parentName: "Kamla", language: "Hindi", city: "Varanasi", primary: true, phoneConnected: false, openAlerts: 0, urgentAlerts: 0, photo: DEMO_PHOTO },
];

const NO_MEMBERS: FamilyMember[] = [];

// The caretaker app. One caretaker may look after several family members; each has its own desk, so the desk
// below remounts (fresh state, fresh polling) whenever the caretaker switches to another person.
export function CareApp({ demo, onLeave }: Props) {
  const [session, setSession] = useState(readSession);
  const accountPhoto = useAccountPhoto();
  const dispatch = useAppDispatch();
  const members = useAppSelector((state) => state.reads.members?.value) ?? NO_MEMBERS;
  const [membersError, setMembersError] = useState("");
  const [open, setOpen] = useState(false);
  const activeId = demo ? "demo-kamla-sharma" : activeHouseholdId(session);

  // The list (with each member's alert counts) is kept for 10 minutes; opening the switcher accepts one a minute old.
  const loadMembers = useCallback(
    async (maxAgeMs?: number) => {
      if (demo) return;
      try {
        await dispatch(loadMembersThunk({ maxAgeMs })).unwrap();
        setMembersError("");
      } catch (err) {
        if ((err as { name?: string })?.name !== "ConditionError") setMembersError("Could not load the full list just now. Check the connection.");
      }
    },
    [demo, dispatch],
  );

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  // Until the server answers, the caretaker's first family member stands in for the list.
  const fallback: FamilyMember[] = session?.email
    ? [{ id: session.email, parentName: session.parentName, language: session.language, city: "", primary: true, phoneConnected: false, openAlerts: 0, urgentAlerts: 0 }]
    : [];
  const list = demo ? DEMO_MEMBERS : members.length ? members : fallback;
  const current = list.find((m) => m.id === activeId);

  function switchTo(id: string) {
    if (!session) return;
    const next = { ...session, activeHousehold: id };
    writeSession(next);
    setSession(next);
    setOpen(false);
  }

  async function add(name: string, language: string) {
    const member = await addFamilyMember(name, language);
    if (!members.length) fallback.forEach((m) => dispatch(memberAdded(m)));
    dispatch(memberAdded(member));
    switchTo(member.id);
  }

  return (
    <>
      <CareDesk
        key={activeId}
        demo={demo}
        onLeave={onLeave}
        session={session}
        householdId={activeId}
        seedName={current?.parentName ?? session?.parentName ?? ""}
        seedLanguage={current?.language ?? session?.language ?? "Hindi"}
        seedCity={current?.city || session?.city || ""}
        memberCount={list.length}
        accountPhoto={demo ? null : accountPhoto}
        onOpenMembers={() => {
          setOpen(true);
          void loadMembers(60_000);
        }}
      />
      {open ? (
        <FamilySwitcher
          members={list}
          activeId={activeId}
          demo={demo}
          loadError={membersError}
          onSwitch={switchTo}
          onAdd={add}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function CareDesk({ demo, onLeave, session, householdId, seedName, seedLanguage, seedCity, memberCount, accountPhoto, onOpenMembers }: DeskProps) {
  const caretaker = demo ? "Rahul" : session?.caretakerName || "";
  const storageKey = demo ? "saathi.desk.demo.v2" : `saathi.desk.${householdId || "local"}`;
  const { desk, setDesk, sync, syncedAt, syncError, retry } = useDesk(storageKey, () =>
    demo ? demoDesk() : blankDesk(seedName, seedLanguage, seedCity),
  );
  const [active, setActive] = useState<TabId>(readTab);
  // Forms use default values, so a reset remounts them.
  const [version] = useState(0);
  // On Ask Saathi the right rail holds that tab's guide, which the tab renders into this slot.
  const [guideSlot, setGuideSlot] = useState<HTMLElement | null>(null);
  const name = desk.profile.preferredName;
  const who = name || "your parent";
  const author = caretaker || "You";
  const family = useFamilyLink(demo ? "demo" : householdId, name, caretaker, !demo && Boolean(householdId));
  const state = useUpdates(householdId, Boolean(householdId));
  const photoUrl = useProfilePhoto(householdId, true) ?? (demo ? DEMO_PHOTO : null);
  const switchHint = memberCount > 1 ? `Switch · ${memberCount} family members` : "Family members";
  const urgentAlerts = (state.updates?.alerts ?? []).filter((a) => a.tier >= 2);
  const conversationMemories = desk.memories.filter((m) => m.author === "conversation").map((m) => m.text);

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
          <span className="tabbar-label">{"short" in tab ? tab.short : tab.label}</span>
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
  const phone = useMedia("(max-width: 1023px)");

  // A delete keeps the desk as it was for a few seconds, so "Undo" can put it back.
  const [undo, setUndo] = useState<{ label: string; before: Desk } | null>(null);
  const undoTimer = useRef(0);
  const deskRef = useRef(desk);
  deskRef.current = desk;
  const undoable = useCallback((label: string) => {
    window.clearTimeout(undoTimer.current);
    setUndo({ label, before: deskRef.current });
    undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
  }, []);

  return (
    <UndoContext.Provider value={undoable}>
    <div className={`care care-tab-${active}`}>
      <aside className="care-side">
        <div className="care-brand">
          <Link className="brand" to="/">
            <img className="brand-logo" src="/brand/saathi-logo.png" width="648" height="422" alt="Saathi" />
          </Link>
          <span className="care-badge">Caretaker</span>
        </div>

        <button type="button" className="care-parent" aria-haspopup="dialog" onClick={onOpenMembers}>
          <PersonAvatar name={name} src={photoUrl} />
          <span className="care-parent-text">
            <span className="care-parent-name">{name || "Add their name"}</span>
            <span className="care-parent-meta">
              {[desk.profile.city, desk.profile.language].filter(Boolean).join(" · ") || "Profile not finished"}
            </span>
            <span className="care-parent-switch">{switchHint}</span>
          </span>
          <svg className="care-parent-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m8 10 4 4 4-4" />
          </svg>
        </button>
        {demo ? <p className="tag care-tag">Demo account · shared, no login</p> : null}

        <div className="care-side-tabs" role="tablist" aria-orientation="vertical" aria-label="Care desk sections">
          {renderTabs("tab", "desk-tab", false)}
        </div>

        <div className="care-side-foot">
          {!demo && session ? (
            <div className="care-me">
              <PersonAvatar name={caretaker || session.email} src={accountPhoto} className="avatar avatar-sm" />
              <span>
                <strong>{caretaker || "You"}</strong>
                <small>{session.email}</small>
              </span>
            </div>
          ) : null}
          <p>{demo ? "Shared demo: changes are saved for everyone." : "Changes save to your account in the cloud and show on every device you log in on."}</p>
          <div className="care-side-actions">
            <button className="text-link" type="button" onClick={onLeave}>
              {demo ? "Leave demo" : "Log out"}
            </button>
          </div>
        </div>
      </aside>

      <header className="care-mbar">
        <button type="button" className="care-mbar-who" aria-haspopup="dialog" onClick={onOpenMembers}>
          <PersonAvatar name={name} src={photoUrl} />
          <span className="care-mbar-text">
            <span className="care-mbar-title">
              Caring for {name || "your parent"}
              <svg className="care-parent-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m8 10 4 4 4-4" />
              </svg>
            </span>
            <span className="care-mbar-sub">
              {demo ? "Caretaker demo · synthetic household" : memberCount > 1 ? `${memberCount} family members` : caretaker || "Caretaker"}
            </span>
          </span>
        </button>
        {!demo && session ? <PersonAvatar name={caretaker || session.email} src={accountPhoto} className="avatar avatar-sm care-mbar-me" /> : null}
        <button className="text-link" type="button" onClick={onLeave}>
          {demo ? "Leave" : "Log out"}
        </button>
      </header>

      <main id="care-panel" className="care-main" role="tabpanel" aria-labelledby={`tab-${active}`}>
        {phone ? <InstallSheet /> : null}
        <header className="care-head">
          <p className="care-greet">
            {!demo && session ? <PersonAvatar name={caretaker || session.email} src={accountPhoto} className="avatar avatar-xs" /> : null}
            {greeting()}
            {caretaker ? `, ${caretaker}` : ""}
            <span className="care-date">
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </span>
          </p>
          <h1>{current.label}</h1>
          <p className="care-sub">{subtitle(active, who)}</p>
          <SyncStatus sync={sync} syncedAt={syncedAt} error={syncError} onRetry={retry} demo={demo} />
        </header>

        {active !== "routine" && urgentAlerts.length ? (
          <section className={`alert-banner alert-tier-${Math.max(...urgentAlerts.map((a) => a.tier))}`} role="alert">
            {/* An urgent alert is shown in full everywhere; an ordinary update is one line, with the detail on Routine. */}
            {urgentAlerts.some((a) => a.tier >= 3) ? (
              <p>
                <strong>Needs your attention now. </strong>
                {urgentAlerts.find((a) => a.tier >= 3)?.message}
              </p>
            ) : (
              <p>
                <strong>New Saathi update</strong> about {who}. Read it on Routine.
              </p>
            )}
            <button className="ghost" type="button" onClick={() => choose("routine")}>
              Open Routine
            </button>
          </section>
        ) : null}

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
              {[...steps].sort((a, b) => Number(a.done) - Number(b.done)).map((step) => (
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
            <FamilyCard link={family.link} name={name} demo={demo} onCreate={() => void family.create()} busy={family.busy} />
            <ProfileTab key={version} desk={desk} setDesk={setDesk} author={author} photo={photoUrl} sync={sync} syncError={syncError} />
            <DocumentsCard
              householdId={householdId}
              name={name}
              demo={demo}
              desk={desk}
              setDesk={setDesk}
              author={author}
            />
          </>
        ) : null}
        {active === "routine" ? <RoutineTab
            householdId={householdId}
            state={state}
            conversationMemories={conversationMemories}
            demo={demo}
            name={name}
            medicines={desk.medicines}
            contacts={desk.contacts}
            language={desk.profile.language}
            onOpenReminders={() => choose("reminders")}
          /> : null}
        {active === "ask" ? <TellSaathiTab desk={desk} setDesk={setDesk} author={author} name={name} guideSlot={guideSlot} householdId={householdId} /> : null}
        {active === "reminders" ? <MedicineTab desk={desk} setDesk={setDesk} name={name} author={author} /> : null}
        {active === "contacts" ? <EmergencyTab desk={desk} setDesk={setDesk} name={name} householdId={householdId} /> : null}
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
              <dt>Voice style</dt>
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
                  <button type="button" className="glance-link" onClick={() => choose("profile")} aria-label={`${desk.people.length} people who matter, open Profile`}>
                    {desk.people.length}
                  </button>
                </dd>
              </div>
              <div>
                <dt>Reminders</dt>
                <dd>
                  <button type="button" className="glance-link" onClick={() => choose("reminders")} aria-label={`${desk.medicines.length} reminders, open Reminders`}>
                    {desk.medicines.length}
                  </button>
                </dd>
              </div>
              <div>
                <dt>Trusted contacts</dt>
                <dd>
                  <button type="button" className="glance-link" onClick={() => choose("contacts")} aria-label={`${desk.contacts.length} trusted contacts, open Trusted Contacts`}>
                    {desk.contacts.length}
                  </button>
                </dd>
              </div>
            </dl>
          </section>

          {demo && urgentAlerts.length ? (
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

      <div className="undo-toast-slot" role="status" aria-live="polite">
        {undo ? (
          <div className="undo-toast">
            <span>Deleted {undo.label}.</span>
            <button
              className="text-link"
              type="button"
              onClick={() => {
                setDesk(undo.before);
                setUndo(null);
              }}
            >
              Undo
            </button>
          </div>
        ) : null}
      </div>
    </div>
    </UndoContext.Provider>
  );
}
