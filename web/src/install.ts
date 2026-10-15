import { useEffect, useState } from "react";

// Chrome's install event. It is the only install prompt; the app does not draw a fake browser dialog.
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type IosNavigator = Navigator & { standalone?: boolean };

const DISMISSED = "saathi.install.dismissed";

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

// Called once from main.tsx, before React renders, so an early event is not lost.
export function listenForInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function isStandalone(): boolean {
  return (
    (navigator as IosNavigator).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

export type InstallMode = "prompt" | "ios" | null;

export function useInstall() {
  const [, setTick] = useState(0);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const update = () => setTick((tick) => tick + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  const mode: InstallMode = installed || isStandalone() ? null : deferred ? "prompt" : isIos() ? "ios" : null;

  async function install() {
    const event = deferred;
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    // The event can be used once. Chrome fires a new one if the person can still install.
    deferred = null;
    notify();
  }

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Private mode: the sheet comes back next visit, which is fine.
    }
  }

  function reopen() {
    setDismissed(false);
    try {
      localStorage.removeItem(DISMISSED);
    } catch {
      // Nothing stored to remove.
    }
  }

  return { mode, dismissed, install, dismiss, reopen };
}
