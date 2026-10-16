// Tabs left open and untouched poll more slowly: a care desk nobody is looking at does not need a fresh copy every
// half minute, and the server bills the database for every one.
let lastActive = Date.now();
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const touch = () => {
    lastActive = Date.now();
  };
  for (const name of ["pointerdown", "keydown", "scroll", "touchstart", "focus"]) {
    window.addEventListener(name, touch, { passive: true });
  }
}

/** 1 while someone is using the page, 2 after 5 quiet minutes, 4 after 15. */
export function idleFactor(): number {
  listen();
  const quiet = Date.now() - lastActive;
  return quiet > 15 * 60_000 ? 4 : quiet > 5 * 60_000 ? 2 : 1;
}

/** How long to wait before the next poll: the base interval, slower when idle, doubling after each failure (to 5 minutes), never sooner than a pause the API asked for. */
export function nextDelay(baseMs: number, failures: number, pausedMs = 0, slowWhenIdle = true): number {
  const slowed = baseMs * (slowWhenIdle ? idleFactor() : 1) * 2 ** Math.min(failures, 4);
  const jitter = 1 + Math.random() * 0.1;
  return Math.max(Math.min(slowed, 300_000), pausedMs) * jitter;
}
