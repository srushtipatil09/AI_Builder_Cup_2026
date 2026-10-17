// The phone's own speech engine. A closed app cannot start it; the page speaks when it is open
// or when the person opens the notification.

const spoken = new Set<string>();

export function speakLine(text: string, lang = "hi-IN") {
  const line = text.trim();
  if (!line || !("speechSynthesis" in window)) return;
  if (spoken.has(line)) return;
  spoken.add(line);
  window.setTimeout(() => spoken.delete(line), 60_000);
  const utterance = new SpeechSynthesisUtterance(line);
  utterance.lang = lang;
  utterance.rate = 0.92;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function listenForSpokenReminders() {
  const params = new URLSearchParams(window.location.search);
  const say = params.get("say");
  if (say) {
    speakLine(say);
    params.delete("say");
    const next = params.toString();
    const url = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; text?: string } | null;
    if (data?.type === "saathi-speak" && data.text) speakLine(data.text);
  });
}
