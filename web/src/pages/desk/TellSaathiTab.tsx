import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { newId, type Desk } from "../../desk";

type Props = {
  desk: Desk;
  setDesk: React.Dispatch<React.SetStateAction<Desk>>;
  author: string;
  name: string;
  guideSlot: HTMLElement | null;
};

type Message = { id: string; from: "you" | "saathi"; text: string; keep?: string; kept?: boolean };

// Shown as one row on a phone, and grouped by what they change on a wide window.
const groups = [
  { title: "Memories", items: ["She likes the temple garden.", "She waters the rose plant every morning."] },
  { title: "People", items: ["Meena is her sister, not her daughter.", "Add Sunil, her nephew, in Lucknow."] },
  { title: "Check-in", items: ["Move the check-in to 9 in the morning.", "Quiet hours are 1 pm to 3 pm."] },
  { title: "Reminders", items: ["The BP tablet is now after breakfast."] },
];

const quick = groups.flatMap((g) => g.items.slice(0, 1));

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function TellSaathiTab({ desk, setDesk, author, name, guideSlot }: Props) {
  const who = name || "the parent";
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "hello",
      from: "saathi",
      text: `Tell me what changed for ${who}, in your own words. I read the change back and save it only after you confirm. I never suggest a dose.`,
    },
  ]);
  const threadRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Scroll the thread itself, never the page.
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  function use(example: string) {
    setDraft(example);
    inputRef.current?.focus();
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((list) => [
      ...list,
      { id: newId(), from: "you", text },
      {
        id: newId(),
        from: "saathi",
        text: "The assistant is not connected yet, so nothing changed. You can keep this as a memory now, or edit the Profile or Reminders tab.",
        keep: text,
      },
    ]);
    setDraft("");
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
            <p className="tell-status">Not connected yet · typing only</p>
          </div>
        </header>

        <ol className="thread" aria-live="polite" ref={threadRef}>
          {messages.map((m) => (
            <li key={m.id} className={m.from === "you" ? "bubble-you" : "bubble-bot"}>
              <span className="bubble-from">{m.from === "you" ? "You" : "Saathi"}</span>
              <p>{m.text}</p>
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
            disabled
            aria-label="Speak. Arrives with the voice connection."
            title="Speaking arrives with the voice connection."
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
          <button className="primary" type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </section>
      {/* The guide lives in the caretaker app's right rail on wide windows. */}
      {guideSlot ? createPortal(guide, guideSlot) : null}
    </div>
  );
}
