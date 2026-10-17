import { useState } from "react";
import { joinUrl, type FamilyLink } from "../../family";
import { useToast } from "../../toast";

type Props = {
  link: FamilyLink | null;
  name: string;
  demo: boolean;
  onCreate: () => void;
  busy?: boolean;
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// Pairs the caretaker's desk with the parent's phone: one short code, one join link.
export function FamilyCard({ link, name, demo, onCreate, busy }: Props) {
  const who = name || "your parent";
  const toast = useToast();
  const [confirmNew, setConfirmNew] = useState(false);
  const url = link ? joinUrl(link.code) : "";
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied. Send it to " + who + "’s phone.", "ok");
    } catch {
      toast("Copy did not work here. Select the link below and copy it.", "bad");
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "Join Saathi",
        text: `Open this on your phone to start Saathi. Family code ${link?.code}.`,
        url,
      });
    } catch {
      // The person closed the share sheet.
    }
  }

  return (
    <section className="family panel-wide" aria-labelledby="family-title">
      <div className="family-top">
        <div>
          <h2 id="family-title">Connect {who}&rsquo;s phone</h2>
          <p>
            Share a family code. {who} opens the link, says what Saathi should call them, and starts talking. No
            password to remember.
          </p>
        </div>
        {link ? (
          <span className={link.joinedAt ? "status-chip status-chip-ok" : "status-chip"}>
            {link.joinedAt ? `Joined ${formatWhen(link.joinedAt)}` : `Waiting for ${who} to join`}
          </span>
        ) : null}
      </div>

      {link ? (
        <>
          <div className="family-code-row">
            <p className="family-code" aria-label={`Family code ${link.code.split("").join(" ")}`}>
              {link.code}
            </p>
            <div className="family-actions">
              <button className="primary" type="button" onClick={() => void copy()}>
                Copy join link
              </button>
              {canShare ? (
                <button className="ghost" type="button" onClick={() => void share()}>
                  Share
                </button>
              ) : null}
              {demo ? (
                <a className="ghost" href={url} target="_blank" rel="noreferrer">
                  Open join page
                </a>
              ) : null}
            </div>
          </div>
          <p className="family-url">
            <span className="visually-hidden">Join link: </span>
            {url}
          </p>
          <div className="family-foot">
            {confirmNew ? (
              <>
                <span>The old code stops working on this desk.</span>
                <button
                  className="text-link"
                  type="button"
                  onClick={() => {
                    onCreate();
                    setConfirmNew(false);
                  }}
                >
                  Make a new code
                </button>
                <button className="text-link" type="button" onClick={() => setConfirmNew(false)}>
                  Keep this one
                </button>
              </>
            ) : (
              <>
                <span>
                  {link.joinedAt && link.joinedName ? `${link.joinedName} joined with this code.` : "Or read the code aloud on a call; they enter it at the join page."}
                </span>
                <button className="text-link" type="button" onClick={() => setConfirmNew(true)}>
                  New code
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <button className="primary family-create" type="button" onClick={onCreate} disabled={busy}>
          {busy ? "Making a code…" : "Create a family code"}
        </button>
      )}
      {demo ? <p className="family-demo">Demo: open the join page in a new tab, join, and come back here.</p> : null}
    </section>
  );
}
