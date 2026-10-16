import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { registerDevice } from "./api";
import { firebaseApp } from "./firebase";

export type PushResult = "on" | "denied" | "unsupported" | "no_key" | "error";

// Asks for notification permission (call from a tap), gets this browser's FCM token, and stores it for the household.
// The push text is fixed on the server: "Saathi wants to talk" for the parent, "New Saathi update" for the family.
async function enablePush(householdId: string, role: "caretaker" | "parent"): Promise<PushResult> {
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  if (!vapidKey) return "no_key";
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !(await isSupported())) return "unsupported";
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(firebaseApp), { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return "error";
    await registerDevice(householdId, token, role);
    return "on";
  } catch {
    return "error";
  }
}

export const enableCaretakerPush = (householdId: string) => enablePush(householdId, "caretaker");
export const enableParentPush = (householdId: string) => enablePush(householdId, "parent");

export function pushMessage(result: PushResult): string {
  switch (result) {
    case "on":
      return "Notifications are on for this device.";
    case "denied":
      return "Notifications are blocked in this browser. The in-app banner still works.";
    case "unsupported":
      return "This browser cannot receive push. The in-app banner still works.";
    case "no_key":
      return "Push is not configured. The in-app banner still works.";
    default:
      return "Could not turn notifications on. The in-app banner still works.";
  }
}
