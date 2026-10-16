import { InstallSheet } from "./InstallSheet";

type Props = { demo: boolean; name?: string };

const demoControls = [
  ["Simulate morning inactivity", "Simulated. This build does not read a Nest sensor."],
  ["Advance demo clock", "Demo clock for this synthetic household only."],
  ["Run seeded session", "Recorded transcript."],
  ["Play labeled distress clip", "Recording."],
  ["Play ordinary door clip", "Recording."],
];

export function CompanionChat({ demo, name }: Props) {
  return (
    <section className="chat-screen" aria-labelledby="chat-title">
      <div className="companion">
        <div className="orb" aria-hidden="true">
          <span lang="hi">सा</span>
        </div>
        <h1 id="chat-title">Talk</h1>
        <p className="companion-line">
          {demo ? "Namaste. This is the Kamla Sharma demo." : `Namaste${name ? `, ${name}` : ""}. The conversation will appear here.`}
        </p>
        <p className="companion-state">Not connected yet. Tap Talk once so the browser can use the microphone.</p>
      </div>
      <article className="captions">
        <h2>Captions</h2>
        <p>Captions will show both sides of the conversation.</p>
      </article>
      {demo ? (
        <details className="demo-panel">
          <summary>
            <span className="demo-tag">Demo</span>
            <span>Demo controls</span>
          </summary>
          <p className="note">These controls are not connected yet.</p>
          <ul>
            {demoControls.map(([label, caption]) => (
              <li key={label}>
                <button className="ghost" type="button" disabled>
                  {label}
                </button>
                <span>{caption}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <InstallSheet />
      <div className="controls" role="group" aria-label="Conversation">
        <button className="primary control-talk" type="button">
          Talk
        </button>
        <button className="ghost" type="button">
          Stop
        </button>
        <button className="ghost" type="button">
          Pause
        </button>
        <button className="ghost control-family" type="button">
          Contact family
        </button>
      </div>
    </section>
  );
}
