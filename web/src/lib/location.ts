import { saveLocation } from "./api";

export type LocationResult = "saved" | "denied" | "unsupported" | "error";

const key = (householdId: string) => `saathi.location.${householdId}`;

// "on" after the person allowed it, "declined" after they said no. Only a convenience: the server holds the position.
export function locationChoice(householdId: string): "on" | "declined" | "" {
  try {
    const v = localStorage.getItem(key(householdId));
    return v === "on" || v === "declined" ? v : "";
  } catch {
    return "";
  }
}

export function rememberLocationChoice(householdId: string, choice: "on" | "declined" | "") {
  try {
    if (choice) localStorage.setItem(key(householdId), choice);
    else localStorage.removeItem(key(householdId));
  } catch {
    // Private mode: it asks again next time.
  }
}

// Asks the browser once (call it from a tap), then sends one position to the household. The server rounds it
// to about 100 m. Nothing is tracked afterwards.
export async function shareLocationOnce(householdId: string): Promise<LocationResult> {
  if (!("geolocation" in navigator)) return "unsupported";
  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 12_000, maximumAge: 10 * 60_000 }),
    );
    await saveLocation(householdId, position.coords.latitude, position.coords.longitude);
    rememberLocationChoice(householdId, "on");
    return "saved";
  } catch (err) {
    const code = (err as GeolocationPositionError | undefined)?.code;
    if (code === 1) {
      rememberLocationChoice(householdId, "declined");
      return "denied";
    }
    return "error";
  }
}

export function locationMessage(result: LocationResult): string {
  switch (result) {
    case "saved":
      return "Thank you. Saathi can now find places near you.";
    case "denied":
      return "Location is blocked in this browser. Saathi will look in your city instead.";
    case "unsupported":
      return "This phone cannot share its location. Saathi will look in your city instead.";
    default:
      return "Could not get the location just now. Try again.";
  }
}

// After 9 pm and before 5 am: no outings are suggested.
export function isLateNow(now = new Date()): boolean {
  const hour = now.getHours();
  return hour >= 21 || hour < 5;
}
