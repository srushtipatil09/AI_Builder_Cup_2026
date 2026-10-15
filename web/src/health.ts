import { useEffect, useState } from "react";

type Health = { service: string; status: string; stage: string };

export type HealthState = { text: string; tone: "ok" | "wait" | "checking" };

// One check of the API on load, shown as a small status pill.
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ text: "Checking the API…", tone: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<Health>;
      })
      .then((body) => setState({ text: `${body.service} is ${body.status} (${body.stage})`, tone: "ok" }))
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setState({ text: "API is not running. Start it on port 8080.", tone: "wait" });
      });
    return () => controller.abort();
  }, []);

  return state;
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
