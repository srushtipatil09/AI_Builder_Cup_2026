const KEY = "saathi.session";

export type HouseholdSession = {
  email: string;
  caretakerName: string;
  parentName: string;
  language: string;
};

export function readSession(): HouseholdSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HouseholdSession>;
    if (!parsed.email) return null;
    return {
      email: parsed.email,
      caretakerName: parsed.caretakerName ?? "",
      parentName: parsed.parentName ?? "",
      language: parsed.language || "Hindi",
    };
  } catch {
    return null;
  }
}

export function writeSession(session: HouseholdSession) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(KEY);
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
