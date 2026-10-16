import { firebaseSignOut } from "./lib/firebase";
import { putMe, type AccountProfile } from "./lib/api";

const KEY = "saathi.session";

// Who the account belongs to. The caretaker sets things up; the parent only talks.
export type Role = "caretaker" | "parent";

export type HouseholdSession = {
  email: string;
  role: Role;
  caretakerName: string;
  parentName: string;
  language: string;
  // The family code this account joined, if any.
  familyCode?: string;
  // The parent chose "Skip for now" on the join step; the chat still offers Join family.
  joinSkipped?: boolean;
  // When the account holder agreed to what Saathi stores, at signup.
  consentAt?: string;
};

const ACCOUNTS = "saathi.accounts";

// The role belongs to the account, so Log in only needs email and password.
// Until Firebase Auth lands, accounts made in this browser are remembered here by email.
function loadAccounts(): Record<string, HouseholdSession> {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS) ?? "{}") as Record<string, HouseholdSession>;
  } catch {
    return {};
  }
}

export function findAccount(email: string): HouseholdSession | null {
  return loadAccounts()[email.toLowerCase()] ?? null;
}

export function readSession(): HouseholdSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HouseholdSession>;
    const role: Role = parsed.role === "parent" ? "parent" : "caretaker";
    // A parent who joined with a family code has no email in this build.
    if (!parsed.email && role !== "parent") return null;
    return {
      email: parsed.email ?? "",
      role,
      caretakerName: parsed.caretakerName ?? "",
      parentName: parsed.parentName ?? "",
      language: parsed.language || "Hindi",
      familyCode: parsed.familyCode,
      joinSkipped: parsed.joinSkipped,
    };
  } catch {
    return null;
  }
}

// The browser copy is a cache. The account profile in Firestore is the record that follows the person.
export function writeSession(session: HouseholdSession) {
  localStorage.setItem(KEY, JSON.stringify(session));
  putMe({
    email: session.email,
    role: session.role,
    caretakerName: session.caretakerName,
    parentName: session.parentName,
    language: session.language,
    familyCode: session.familyCode ?? null,
    joinSkipped: session.joinSkipped ?? false,
    consentAt: session.consentAt ?? null,
  }).catch(() => {
    // Not signed in with Firebase, or offline: the browser copy still works.
  });
  if (session.email) {
    const accounts = loadAccounts();
    accounts[session.email.toLowerCase()] = session;
    localStorage.setItem(ACCOUNTS, JSON.stringify(accounts));
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
  firebaseSignOut().catch(() => {});
}

// Each role has its own app: the caretaker's desk, or the parent's chat.
export function homePath(session: HouseholdSession | null): string {
  if (!session) return "/login";
  return session.role === "parent" ? "/app" : "/care";
}

// A parent sees "Join your family" once after signing in, until they join or skip it.
export function needsJoin(session: HouseholdSession): boolean {
  return session.role === "parent" && !session.familyCode && !session.joinSkipped;
}

// Where to go straight after signing up or logging in.
export function afterSignIn(session: HouseholdSession): string {
  return needsJoin(session) ? "/join" : homePath(session);
}

// The browser keys a household's desk by the caretaker's email.
export function householdKey(session: HouseholdSession | null): string {
  return `saathi.desk.${session?.email || "local"}`;
}

export function emailError(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter an email address like name@example.com.";
  }
  return null;
}

export function passwordError(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  return null;
}

// Only the caretaker app, or a parent's join page, may be named as the place to return to after login.
export function nextPath(params: URLSearchParams, session: HouseholdSession | null): string {
  const next = params.get("next") ?? "";
  if (next === "/care" && session?.role !== "parent") return "/care";
  if (session?.role === "parent" && /^\/join(\/[A-Z0-9]{3}-[A-Z0-9]{3})?$/.test(next)) return next;
  return session ? afterSignIn(session) : "/login";
}

// A session rebuilt from the account profile stored in Firestore.
export function fromProfile(p: AccountProfile): HouseholdSession {
  return {
    email: p.email,
    role: p.role === "parent" ? "parent" : "caretaker",
    caretakerName: p.caretakerName,
    parentName: p.parentName,
    language: p.language || "Hindi",
    familyCode: p.familyCode ?? undefined,
    joinSkipped: p.joinSkipped || undefined,
    consentAt: p.consentAt ?? undefined,
  };
}
