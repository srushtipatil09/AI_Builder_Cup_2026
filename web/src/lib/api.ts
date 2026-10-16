import { currentIdToken } from "./firebase";
import type { Desk } from "../desk";
import type { FamilyLink } from "../family";
import { readSession } from "../session";

const API_ORIGIN = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, "") : "";
const BASE_URL = `${API_ORIGIN}/api/v1`;

// The API speaks snake_case; the web app's FamilyLink is camelCase.
function toLink(raw: Record<string, string | null>): FamilyLink {
  return {
    code: raw.code ?? "",
    household: raw.household_id ?? "",
    parentName: raw.parent_name ?? "",
    caretakerName: raw.caretaker_name ?? "",
    createdAt: raw.created_at ?? "",
    joinedAt: raw.joined_at ?? undefined,
    joinedName: raw.joined_name ?? undefined,
  };
}

async function getAuthHeaders(householdId?: string, role?: string): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (householdId) {
    headers["X-Household-Id"] = householdId;
  }
  if (role) {
    headers["X-Role"] = role;
  }
  // A parent's phone has no account; the family code it joined with is its credential for that household.
  const code = readSession()?.familyCode;
  if (code) headers["X-Family-Code"] = code;
  try {
    const token = await currentIdToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch {
    // Not signed in with Firebase; the API falls back to demo mode.
  }
  return headers;
}

export async function fetchDesk(householdId: string, isDemo = false): Promise<Desk> {
  const url = isDemo ? `${BASE_URL}/demo/desk` : `${BASE_URL}/households/${householdId}/desk`;
  const res = await fetch(url, {
    headers: await getAuthHeaders(householdId),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch desk: ${res.statusText}`);
  }
  return res.json();
}

export async function saveDesk(householdId: string, desk: Desk, isDemo = false): Promise<Desk> {
  const url = isDemo ? `${BASE_URL}/demo/desk` : `${BASE_URL}/households/${householdId}/desk`;
  const res = await fetch(url, {
    method: "PUT",
    headers: await getAuthHeaders(householdId),
    body: JSON.stringify(desk),
  });
  if (!res.ok) {
    throw new Error(`Failed to save desk: ${res.statusText}`);
  }
  return res.json();
}

export async function createPairingLink(householdId: string, caretakerName: string, parentName: string): Promise<FamilyLink> {
  const params = new URLSearchParams({ caretaker_name: caretakerName, parent_name: parentName });
  const res = await fetch(`${BASE_URL}/households/${householdId}/pairing?${params}`, {
    method: "POST",
    headers: await getAuthHeaders(householdId),
  });
  if (!res.ok) {
    throw new Error(`Failed to create pairing link: ${res.statusText}`);
  }
  return toLink(await res.json());
}

export type SessionSummary = {
  duration_seconds: number;
  response_gap_ms?: number;
  speaking_rate_wpm?: number;
  quality_flags: string[];
};

export async function completeSession(sessionId: string, householdId: string, summary: SessionSummary): Promise<void> {
  await fetch(`${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST",
    headers: await getAuthHeaders(householdId),
    body: JSON.stringify(summary),
    keepalive: true,
  });
}

// The household's current family code and whether the parent has joined, from the server.
export async function fetchPairing(householdId: string): Promise<FamilyLink | null> {
  const res = await fetch(`${BASE_URL}/households/${encodeURIComponent(householdId)}/pairing`, {
    headers: await getAuthHeaders(householdId),
  });
  if (!res.ok) throw new Error(`Failed to load the family code: ${res.statusText}`);
  const raw = await res.json();
  return raw ? toLink(raw) : null;
}

export async function lookupFamilyCode(code: string): Promise<FamilyLink> {
  const res = await fetch(`${BASE_URL}/pair/${encodeURIComponent(code)}`);
  if (!res.ok) {
    throw new Error(`Code not found: ${res.statusText}`);
  }
  return toLink(await res.json());
}

export async function pairFamilyCode(code: string, parentName: string): Promise<FamilyLink> {
  const res = await fetch(`${BASE_URL}/pair`, {
    method: "POST",
    // A signed-in parent is recorded as a member of the household; an anonymous one is not.
    headers: await getAuthHeaders(),
    body: JSON.stringify({ code, parent_name: parentName }),
  });
  if (!res.ok) {
    throw new Error(`Failed to pair code: ${res.statusText}`);
  }
  return toLink(await res.json());
}

// ---- Care desk reads: what the post-call pipeline produced ----

export type Insight = {
  tier: number;
  headline: string;
  body: string;
  evidence_ids: string[];
  suggested_action: string;
  safety_passed: boolean;
  created_at?: string;
};

export type Drift = {
  status: string;
  baseline_days_count: number;
  recent_days_count: number;
  is_candidate: boolean;
  metric_name?: string | null;
  z_score?: number | null;
  recent_mean?: number | null;
  baseline_mean?: number | null;
  explanation: string;
  meal_followup?: boolean;
  context_notes?: string[];
  engine?: string;
};

export type FamilyCard = {
  person: string;
  earlier_quote: string;
  earlier_date: string;
  later_quote: string;
  later_date: string;
  recommended_action: string;
  helpline: string;
  loneliness_quotes?: string[];
};

export type CareAlert = {
  id: string;
  tier: number;
  message: string;
  action: string;
  created_at: string;
  evidence_ids?: string[];
};

export type Updates = {
  insight: Insight | null;
  familyCard: FamilyCard | null;
  drift: Drift | null;
  alerts: CareAlert[];
  summaries: { date: string; text: string; session_id: string }[];
  sessionsProcessed: number;
  lastProcessedAt: string | null;
  synthetic: boolean;
  serverTime: string;
};

export type DailyRow = {
  local_date: string;
  response_gap_ms: number | null;
  speaking_rate_wpm: number | null;
  meals_reported: number;
  meals_skipped: number;
  family_contact: boolean;
  mood: string | null;
  is_fasting: boolean;
  is_ill: boolean;
  synthetic?: boolean;
};

export type Metrics = { days: DailyRow[]; drift: Drift | null; synthetic: boolean };

async function getJson<T>(path: string, householdId: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: await getAuthHeaders(householdId) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function postJson<T>(path: string, householdId: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: await getAuthHeaders(householdId),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      // keep the status text
    }
    throw new Error(String(detail));
  }
  return res.json();
}

const hh = (id: string) => `/households/${encodeURIComponent(id)}`;

export const fetchUpdates = (id: string) => getJson<Updates>(`${hh(id)}/updates`, id);
export const fetchMetrics = (id: string, days = 14) => getJson<Metrics>(`${hh(id)}/metrics?days=${days}`, id);
export const ackAlert = (id: string, alertId: string) => postJson(`${hh(id)}/alerts/${encodeURIComponent(alertId)}/ack`, id);
export const registerDevice = (id: string, token: string, role: "caretaker" | "parent") =>
  postJson(`${hh(id)}/devices`, id, { token, role });

// ---- Ask Saathi ----

export type Proposal = {
  id: string;
  status: "awaiting_confirmation" | "applied" | "cancelled" | "needs_more";
  kind: string;
  readback: string;
  question: string;
  hash: string;
};

export const askSaathi = (id: string, text: string) => postJson<Proposal>(`${hh(id)}/ask`, id, { text });
export const confirmAsk = (id: string, proposal: Proposal) =>
  postJson<{ status: string; desk: Desk }>(`${hh(id)}/ask/confirm`, id, { proposal_id: proposal.id, hash: proposal.hash });
export const cancelAsk = (id: string, proposalId: string) => postJson(`${hh(id)}/ask/${encodeURIComponent(proposalId)}/cancel`, id);

// ---- The parent's open chat ----

export type Invitation = { id: string; reason: string; attempt: number };

export const sendHeartbeat = (id: string) => postJson(`${hh(id)}/heartbeat`, id);
export const nextInvitation = (id: string) => getJson<{ invitation: Invitation | null }>(`${hh(id)}/invitation`, id);
export const invitationEvent = (id: string, invitationId: string, event: "played" | "responded" | "snoozed" | "device_unavailable", reason = "") =>
  postJson(`${hh(id)}/invitation/${encodeURIComponent(invitationId)}/${event}`, id, { reason });

// ---- Demo household only ----

export const seedDemoHistory = (scenario: "stable" | "changing" | "fasting" | "family") =>
  postJson(`/demo/seed`, "demo-kamla-sharma", { household: "demo-kamla-sharma", scenario });
export const runSeededSession = () => postJson<{ sessionId: string }>(`/demo/run-seeded-session`, "demo-kamla-sharma", { household: "demo-kamla-sharma" });
export const simulateCheckin = (outcome: "unanswered" | "device_unavailable") =>
  postJson<{ label: string; events: { type: string }[] }>(`/demo/simulate-checkin`, "demo-kamla-sharma", { household: "demo-kamla-sharma", outcome });

export const contactFamily = (id: string) => postJson(`${hh(id)}/contact-family`, id);

// The signed-in account's profile, kept in Firestore so a new device knows the role and names.
export type AccountProfile = {
  email: string;
  role: "caretaker" | "parent";
  caretakerName: string;
  parentName: string;
  language: string;
  familyCode?: string | null;
  joinSkipped?: boolean;
};

export async function fetchMe(): Promise<AccountProfile | null> {
  const res = await fetch(`${BASE_URL}/me`, { headers: await getAuthHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load account: ${res.statusText}`);
  return res.json();
}

export async function putMe(profile: AccountProfile): Promise<void> {
  const res = await fetch(`${BASE_URL}/me`, {
    method: "PUT",
    headers: await getAuthHeaders(),
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`Failed to save account: ${res.statusText}`);
}

// Private photos and documents (profile photo, prescriptions, identity proofs).
export type FileCategoryId =
  | "profile_photo"
  | "family_photos"
  | "prescriptions"
  | "medical_reports"
  | "medical_bills"
  | "medicine_photos"
  | "identity_proofs"
  | "insurance"
  | "other";

export type FileCategory = { id: FileCategoryId; title: string; hint: string; privateOnly: boolean };

export type StoredFile = {
  id: string;
  category: FileCategoryId;
  name: string;
  label: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  visibility: "public" | "private";
  publicUrl?: string;
};

export async function fetchCategories(): Promise<FileCategory[]> {
  const res = await fetch(`${BASE_URL}/files/categories`);
  if (!res.ok) throw new Error(`Failed to load categories: ${res.statusText}`);
  return res.json();
}

export async function listFiles(householdId: string): Promise<StoredFile[]> {
  const res = await fetch(`${BASE_URL}/households/${encodeURIComponent(householdId)}/files`, {
    headers: await getAuthHeaders(householdId),
  });
  if (!res.ok) throw new Error(`Failed to list files: ${res.statusText}`);
  return res.json();
}

export async function uploadFile(
  householdId: string,
  file: File,
  category: FileCategoryId,
  label = "",
  visibility: "public" | "private" = "private",
): Promise<StoredFile> {
  const headers = (await getAuthHeaders(householdId)) as Record<string, string>;
  headers["Content-Type"] = file.type;
  const query = new URLSearchParams({ category, name: file.name, label, visibility });
  const res = await fetch(`${BASE_URL}/households/${encodeURIComponent(householdId)}/files?${query}`, {
    method: "POST",
    headers,
    body: file,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Upload failed: ${res.statusText}`);
  }
  return res.json();
}

// A link that opens the file. A private file's link carries a key that stops working after 30 minutes.
export type FileLink = { url: string; expiresAt?: string | null; expiresInSeconds?: number | null };

export async function fileLink(householdId: string, fileId: string): Promise<FileLink> {
  const res = await fetch(`${BASE_URL}/households/${encodeURIComponent(householdId)}/files/${fileId}/link`, {
    headers: await getAuthHeaders(householdId),
  });
  if (!res.ok) throw new Error(`Failed to open file: ${res.statusText}`);
  return res.json();
}

export async function deleteFile(householdId: string, fileId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/households/${encodeURIComponent(householdId)}/files/${fileId}`, {
    method: "DELETE",
    headers: await getAuthHeaders(householdId),
  });
  if (!res.ok) throw new Error(`Failed to delete file: ${res.statusText}`);
}

// One typed turn over HTTP, used when the live socket is not open. Returns Saathi's reply.
export async function textTurn(sessionId: string, householdId: string, text: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/text`, {
    method: "POST",
    headers: await getAuthHeaders(householdId, "parent"),
    body: JSON.stringify({ text, household_id: householdId }),
  });
  if (!res.ok) throw new Error(`Text turn failed: ${res.statusText}`);
  return (await res.json()).reply ?? "";
}
