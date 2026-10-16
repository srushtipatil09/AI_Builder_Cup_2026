import type { Desk } from "../desk";
import type { FamilyLink } from "../family";

const BASE_URL = "/api/v1";

function getAuthHeaders(householdId?: string, role?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (householdId) {
    headers["X-Household-Id"] = householdId;
  }
  if (role) {
    headers["X-Role"] = role;
  }
  return headers;
}

export async function fetchDesk(householdId: string, isDemo = false): Promise<Desk> {
  const url = isDemo ? `${BASE_URL}/demo/desk` : `${BASE_URL}/households/${householdId}/desk`;
  const res = await fetch(url, {
    headers: getAuthHeaders(householdId),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch desk: ${res.statusText}`);
  }
  return res.json();
}

export async function saveDesk(householdId: string, desk: Desk, isDemo = false): Promise<Desk> {
  if (isDemo) {
    return desk;
  }
  const res = await fetch(`${BASE_URL}/households/${householdId}/desk`, {
    method: "PUT",
    headers: getAuthHeaders(householdId),
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
    headers: getAuthHeaders(householdId),
  });
  if (!res.ok) {
    throw new Error(`Failed to create pairing link: ${res.statusText}`);
  }
  return res.json();
}

export async function lookupFamilyCode(code: string): Promise<FamilyLink> {
  const res = await fetch(`${BASE_URL}/pair/${encodeURIComponent(code)}`);
  if (!res.ok) {
    throw new Error(`Code not found: ${res.statusText}`);
  }
  return res.json();
}

export async function pairFamilyCode(code: string, parentName: string): Promise<FamilyLink> {
  const res = await fetch(`${BASE_URL}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, parent_name: parentName }),
  });
  if (!res.ok) {
    throw new Error(`Failed to pair code: ${res.statusText}`);
  }
  return res.json();
}
