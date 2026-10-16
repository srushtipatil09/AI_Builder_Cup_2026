import { useInstall } from "../install";

// The four pictures for iPhone, which has no install-prompt API.
function ShareIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <rect x="12" y="20" width="24" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M24 6v22M17 13l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <rect x="9" y="9" width="30" height="30" rx="7" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M24 17v14M17 24h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const iosSteps = [
  { picture: <ShareIcon />, text: "Tap Share in the Safari toolbar." },
  { picture: <AddIcon />, text: "Scroll down. Tap Add to Home Screen." },
  { picture: <span className="ios-add">Add</span>, text: "Tap Add, top right." },
  {
    picture: <img src="/icons/icon-192.png" width="192" height="192" alt="" />,
    text: "Open Saathi from the Home Screen.",
  },
];

export function InstallSheet() {
  const { mode, dismissed, install, dismiss, reopen } = useInstall();

  if (!mode) return null;

  if (dismissed) {
    return (
      <p className="install-again">
        <button className="text-link" type="button" onClick={reopen}>
          Install Saathi on this phone
        </button>
      </p>
    );
  }

  return (
    <section className="install-sheet" aria-labelledby="install-title">
      <div className="install-head">
        <img src="/icons/icon-192.png" width="192" height="192" alt="" />
        <div>
          <h2 id="install-title">{mode === "ios" ? "Add Saathi to the Home Screen" : "Install Saathi"}</h2>
          <p>It opens like an app. At check-in time a notification asks to open it. A closed app does not listen.</p>
        </div>
      </div>
      {mode === "ios" ? (
        <ol className="ios-steps">
          {iosSteps.map((step, index) => (
            <li key={step.text}>
              <span className="ios-picture">{step.picture}</span>
              <span className="ios-step-text">
                <strong>{index + 1}.</strong> {step.text}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="install-actions">
        {mode === "prompt" ? (
          <button className="primary" type="button" onClick={() => void install()}>
            Install Saathi
          </button>
        ) : null}
        <button className="ghost" type="button" onClick={dismiss}>
          {mode === "ios" ? "Done" : "Not now"}
        </button>
      </div>
    </section>
  );
}
