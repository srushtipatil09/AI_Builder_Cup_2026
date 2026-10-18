import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { newId, type Desk } from "../../desk";
import { askSaathi, cancelAsk, confirmAsk, type Proposal } from "../../lib/api";

type Props = {
  desk: Desk;
  setDesk: React.Dispatch<React.SetStateAction<Desk>>;
  author: string;
  name: string;
  guideSlot: HTMLElement | null;
  householdId: string;
};

type Message = {
  id: string;
  from: "you" | "saathi";
  text: string;
  keep?: string;
  kept?: boolean;
  // A change read back and waiting for a yes. "done" and "cancelled" close it.
  proposal?: Proposal;
  outcome?: "done" | "cancelled" | "working";
};

// Shown as one row on a phone, and grouped by what they change on a wide window.
const groups = [
  { title: "Ask", items: ["How has she been in the last 4 days?", "Are the pauses longer than her earlier days?", "Did she eat well this week?"] },
  { title: "Memories", items: ["She likes the temple garden.", "She waters the rose plant every morning."] },
  { title: "People", items: ["Meena is her sister, not her daughter.", "Add Sunil, her nephew, in Lucknow."] },
  { title: "Check-in", items: ["Move the check-in to 9 in the morning.", "Quiet hours are 1 pm to 3 pm."] },
  { title: "Reminders", items: ["The BP tablet is now after breakfast.", "Remind her to walk at 6 every evening.", "Lunch every day at 1 pm, dal from the fridge."] },
];

const quick = groups.flatMap((g) => g.items.slice(0, 1));

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function TellSaathiTab({ desk, setDesk, author, name, guideSlot, householdId }: Props) {
  const who = name || "the parent";
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "hello",
      from: "saathi",
      text: `Tell me what changed for ${who}, or ask how ${who} has been. I read each change back and save it only after you confirm. I answer questions only from what Saathi has recorded, and I never suggest a dose.`,
    },
  ]);
  const threadRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // Scroll the thread itself, never the page.
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  function use(example: string) {
    setDraft(example);
    inputRef.current?.focus();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setMessages((list) => [...list, { id: newId(), from: "you", text }]);
    setDraft("");
    setSending(true);
    try {
      const proposal = await askSaathi(householdId, text);
      if (proposal.status === "awaiting_confirmation") {
        setMessages((list) => [
          ...list,
          { id: newId(), from: "saathi", text: `${proposal.readback} Should I save this?`, proposal },
        ]);
      } else if (proposal.status === "answered") {
        setMessages((list) => [...list, { id: newId(), from: "saathi", text: proposal.answer || "I have nothing recorded for that." }]);
      } else {
        setMessages((list) => [...list, { id: newId(), from: "saathi", text: proposal.question || "I could not turn that into one change." }]);
      }
    } catch {
      setMessages((list) => [
        ...list,
        {
          id: newId(),
          from: "saathi",
          text: "I could not reach the assistant, so nothing changed. You can keep this as a memory now, or edit the Profile or Reminders tab.",
          keep: text,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function decide(message: Message, yes: boolean) {
    const proposal = message.proposal;
    if (!proposal) return;
    setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, outcome: "working" } : m)));
    try {
      if (yes) {
        const result = await confirmAsk(householdId, proposal);
        setDesk((d) => ({ ...d, ...result.desk }));
        setMessages((list) => [
          ...list.map((m) => (m.id === message.id ? { ...m, outcome: "done" as const } : m)),
          { id: newId(), from: "saathi", text: "Saved. Saathi will use it from the next conversation." },
        ]);
      } else {
        await cancelAsk(householdId, proposal.id);
        setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, outcome: "cancelled" as const } : m)));
      }
    } catch (err) {
      setMessages((list) => [
        ...list.map((m) => (m.id === message.id ? { ...m, outcome: undefined } : m)),
        { id: newId(), from: "saathi", text: err instanceof Error ? `That was not saved. ${err.message}` : "That was not saved." },
      ]);
    }
  }

  // Dictation uses the browser's speech recognition. The text lands in the box, so it is still read back before saving.
  function dictate() {
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-IN";
    recognition.interimResults = false;
    recognition.onresult = (e: any) => setDraft((d) => `${d} ${e.results[0][0].transcript}`.trim());
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  function keep(message: Message) {
    if (!message.keep) return;
    const memory = { id: newId(), text: message.keep, author, addedAt: new Date().toISOString() };
    setDesk((d) => ({ ...d, memories: [memory, ...d.memories] }));
    setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, kept: true } : m)));
  }

  const recent = desk.memories.slice(0, 3);

  const guide = (
    <div className="ask-guide">
      <section className="rail-card">
        <h2>Try saying</h2>
        {groups.map((group) => (
          <div key={group.title} className="ask-group">
            <p className="ask-group-title">{group.title}</p>
            {group.items.map((item) => (
              <button key={item} type="button" className="ask-example" onClick={() => use(item)}>
                {item}
              </button>
            ))}
          </div>
        ))}
      </section>

      <section className="rail-card">
        <h2>How it works</h2>
        <ol className="ask-steps">
          <li>
            <strong>You say it</strong> in your own words, typed or spoken.
          </li>
          <li>
            <strong>Saathi reads it back</strong> as one clear change.
          </li>
          <li>
            <strong>You confirm</strong>, and only then is it saved.
          </li>
        </ol>
        <p className="ask-note">Medicines are copied exactly as you write them. Saathi never suggests a dose.</p>
      </section>

      <section className="rail-card">
        <h2>Recently added</h2>
        {recent.length ? (
          <ul className="ask-recent">
            {recent.map((m) => (
              <li key={m.id}>
                <strong>{m.text}</strong>
                <span>
                  {m.author}, {formatWhen(m.addedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No memories yet. Keep one from the chat and it appears here.</p>
        )}
      </section>
    </div>
  );

  return (
    <div className="ask">
      <section className="panel tell" aria-label="Conversation with Saathi">
        <header className="tell-bar">
          <span className="tell-avatar" lang="hi" aria-hidden="true">
            सा
          </span>
          <div>
            <p className="tell-title">Saathi</p>
            <p className="tell-status">Reads each change back · saves after you confirm</p>
          </div>
        </header>

        <ol className="thread" aria-live="polite" ref={threadRef}>
          {messages.map((m) => (
            <li key={m.id} className={m.from === "you" ? "bubble-you" : "bubble-bot"}>
              <span className="bubble-from">{m.from === "you" ? "You" : "Saathi"}</span>
              <p>{m.text}</p>
              {m.proposal ? (
                m.outcome === "done" ? (
                  <span className="kept">Saved</span>
                ) : m.outcome === "cancelled" ? (
                  <span className="kept">Not saved</span>
                ) : (
                  <span className="bubble-actions">
                    <button className="primary bubble-action" type="button" disabled={m.outcome === "working"} onClick={() => void decide(m, true)}>
                      Yes, save it
                    </button>{" "}
                    <button className="ghost bubble-action" type="button" disabled={m.outcome === "working"} onClick={() => void decide(m, false)}>
                      No
                    </button>
                  </span>
                )
              ) : null}
              {m.keep ? (
                m.kept ? (
                  <span className="kept">Kept as a memory</span>
                ) : (
                  <button className="ghost bubble-action" type="button" onClick={() => keep(m)}>
                    Keep as a memory
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ol>

        <div className="examples" aria-label="Examples">
          {quick.map((example) => (
            <button key={example} className="chip" type="button" onClick={() => use(example)}>
              {example}
            </button>
          ))}
        </div>

        <form className="composer" onSubmit={send}>
          <button
            className="mic"
            type="button"
            onClick={dictate}
            disabled={listening || !((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)}
            aria-label={listening ? "Listening" : "Speak the change"}
            title="Speak the change. It is typed into the box and read back before saving."
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" />
            </svg>
          </button>
          <input
            ref={inputRef}
            aria-label="Message to Saathi"
            placeholder="Type what changed"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="primary" type="submit" disabled={!draft.trim() || sending}>
            {sending ? "Reading..." : "Send"}
          </button>
        </form>
      </section>
      {/* The guide lives in the caretaker app's right rail on wide windows. */}
      {guideSlot ? createPortal(guide, guideSlot) : null}
    </div>
  );
}
