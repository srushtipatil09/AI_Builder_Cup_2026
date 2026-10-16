import { useEffect, useRef, useState } from "react";
import { ackAlert, runSeededSession, seedDemoHistory, simulateCheckin, type DailyRow } from "../../lib/api";
import { enableCaretakerPush, pushMessage } from "../../lib/push";
import type { UpdatesState } from "../../lib/useUpdates";
import { StaticDemoRoutine, type Props } from "./DailyTab";
import { ColumnChart, DotChart } from "./charts";
import { UrgentReminders } from "./UrgentReminders";

type LiveProps = Props & {
  householdId: string;
  state: UpdatesState;
  conversationMemories: string[];
};

function dayNumber(date: string) {
  return Number(date.slice(8, 10));
}

function dateLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

const MOODS = ["Good", "Okay", "Low"];

// The Routine tab: what the post-call pipeline wrote, read from the API. Nothing here is kept in this browser.
export function RoutineTab(props: LiveProps) {
  const { demo, name, medicines, onOpenReminders, onConfirmReminder, householdId, state, conversationMemories } = props;
  const { updates, metrics, error, loadedAt, refresh } = state;
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [pushNote, setPushNote] = useState("");
  const who = name || "the parent";
  const seeded = useRef(false);

  // The shared demo household starts with the labeled synthetic history, so a reviewer does not face an empty desk.
  useEffect(() => {
    if (demo && metrics && metrics.days.length === 0 && !seeded.current) {
      seeded.current = true;
      void seedDemoHistory("family").then(refresh).catch(() => {});
    }
  }, [demo, metrics, refresh]);

  if (error && !updates && demo) {
    return <StaticDemoRoutine {...props} />;
  }

  const rows: DailyRow[] = metrics?.days ?? [];
  const dates = new Map(rows.map((r) => [dayNumber(r.local_date), r.local_date]));
  const tipLabel = (day: number) => (dates.get(day) ? dateLabel(dates.get(day)!) : `Day ${day}`);
  const drift = updates?.drift ?? null;
  const insight = updates?.insight ?? null;
  const card = updates?.familyCard ?? null;
  const synthetic = Boolean(metrics?.synthetic || updates?.synthetic);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setNote("");
    try {
      await action();
      refresh();
      window.setTimeout(refresh, 4000);
      window.setTimeout(refresh, 9000);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy("");
    }
  }

  const recent = rows.slice(-3);
  const meals = recent.reduce((sum, d) => sum + (d.meals_reported ?? 0), 0);
  const lastContact = [...rows].reverse().find((d) => d.family_contact)?.local_date;
  const gapRows = rows.filter((d) => d.response_gap_ms !== null);
  const gapMax = Math.max(1000, ...gapRows.map((d) => Math.ceil((d.response_gap_ms ?? 0) / 500) * 500));

  return (
    <div className="tab-grid">
      <UrgentReminders medicines={medicines} name={name} onOpen={onOpenReminders} onConfirm={onConfirmReminder} />

      {(updates?.alerts ?? []).filter((a) => a.tier >= 3 || !(insight || card)).map((a) => (
        <section key={a.id} className={`panel panel-wide alert-card alert-tier-${a.tier}`} role="alert">
          <h2>{a.tier >= 3 ? "Needs your attention now" : a.tier === 2 ? "New update" : "Note"}</h2>
          <p>{a.message}</p>
          <p className="alert-meta">
            {ago(a.created_at)} · Suggested: {a.action}
            {a.evidence_ids?.length ? ` · ${a.evidence_ids.length} record${a.evidence_ids.length === 1 ? "" : "s"}` : ""}
          </p>
          {a.tier >= 3 ? <p>If you cannot reach {who}, contact local emergency services.</p> : null}
          <button className="ghost" type="button" onClick={() => void run("ack", () => ackAlert(householdId, a.id))}>
            Mark as seen
          </button>
        </section>
      ))}

      {synthetic ? (
        <p className="synthetic panel-wide">
          <strong>Synthetic history.</strong> The demo household&rsquo;s days are labeled synthetic. They are not measurements.
        </p>
      ) : null}

      {insight || card ? (
        <section className="panel panel-wide panel-accent insight-card" aria-labelledby="insight-title">
          <h2 id="insight-title">{card ? `Mentions of ${card.person} changed` : insight?.headline}</h2>
          {card ? (
            <ol className="quotes">
              <li>
                <span className="quote-day">{dateLabel(card.earlier_date)}</span>
                <q lang="hi-Latn">{card.earlier_quote}</q>
              </li>
              <li>
                <span className="quote-day">{dateLabel(card.later_date)}</span>
                <q lang="hi-Latn">{card.later_quote}</q>
              </li>
            </ol>
          ) : (
            <p>{insight?.body}</p>
          )}
          {card?.loneliness_quotes?.length ? (
            <p>
              In {who}&rsquo;s own words: {card.loneliness_quotes.map((q) => `“${q}”`).join(" ")}
            </p>
          ) : null}
          {card ? (
            <p>
              A call with {card.person}, or time with a counsellor the family chooses, is a reasonable next step.{" "}
              <a href="tel:14567">Elderline 14567</a> is a published India helpline for older people. Confirm it serves{" "}
              {who}&rsquo;s state.
            </p>
          ) : null}
          {insight ? (
            <p className="alert-meta">
              {insight.tier >= 2 ? "Suggested next step: " : ""}
              {insight.suggested_action}
              {insight.evidence_ids.length
                ? ` · based on ${insight.evidence_ids.length} stored record${insight.evidence_ids.length === 1 ? "" : "s"}`
                : ""}
              {insight.created_at ? ` · ${ago(insight.created_at)}` : ""}
            </p>
          ) : null}
          {(updates?.alerts ?? [])
            .filter((a) => a.tier < 3)
            .slice(0, 1)
            .map((a) => (
              <button
                key={a.id}
                className="ghost"
                type="button"
                onClick={() =>
                  void run("ack", async () => {
                    for (const x of (updates?.alerts ?? []).filter((y) => y.tier < 3)) await ackAlert(householdId, x.id);
                  })
                }
              >
                Mark as seen
              </button>
            ))}
        </section>
      ) : null}

      <section className="panel panel-wide" aria-labelledby="routine-status">
        <h2 id="routine-status">{drift?.status === "Evaluated" ? (insight || card ? "Everything else, compared with their usual days" : "Compared with their own usual days") : "Learning usual routine"}</h2>
        {drift ? (
          <p className="panel-lede">
            {drift.explanation}
            {drift.status !== "Evaluated"
              ? ` Saathi compares ${who} with their own earlier days, so it needs a week of conversations first. There is no health score.`
              : ""}
          </p>
        ) : (
          <p className="panel-lede">
            Meals, conversation time, reported mood, and family contact appear here after the first conversations are
            processed. There is no health score.
          </p>
        )}
        {drift?.context_notes?.length ? <p>{drift.context_notes.join(" ")}</p> : null}
        <p className="alert-meta">
          {error ? "Could not refresh just now. " : ""}
          {loadedAt ? `Updated ${ago(new Date(loadedAt).toISOString())}` : "Loading"}
          {updates
            ? updates.sessionsProcessed === 0 && rows.some((d) => d.synthetic)
              ? " · synthetic days, no real conversation processed yet"
              : ` · ${updates.sessionsProcessed} conversation${updates.sessionsProcessed === 1 ? "" : "s"} processed`
            : ""}
          {drift?.engine ? ` · compared by ${drift.engine === "bigquery" ? "BigQuery SQL" : "the service"}` : ""}
        </p>
        <p>
          <button
            className="ghost"
            type="button"
            onClick={() => void enableCaretakerPush(householdId).then((r) => setPushNote(pushMessage(r)))}
          >
            Notify me on this device
          </button>{" "}
          <span className="alert-meta">{pushNote || "Alerts always show here. A push says only “New Saathi update”."}</span>
        </p>
      </section>

      {rows.length ? (
        <>
          <section className="tiles panel-wide" aria-label="Last three days">
            <div className="tile">
              <span className="tile-label">Meals mentioned, last 3 days</span>
              <span className="tile-value">
                {meals} <small>of {recent.length * 3}</small>
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">{rows.some((d) => d.synthetic) ? "Days in the synthetic history" : "Days with a processed conversation"}</span>
              <span className="tile-value">
                {rows.length} <small>of 14</small>
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">Last mentioned family contact</span>
              <span className="tile-value">{lastContact ? dateLabel(lastContact) : "Not yet"}</span>
            </div>
          </section>

          <section className="panel">
            <ColumnChart
              title="Meals mentioned each day"
              values={rows.map((d) => ({ day: dayNumber(d.local_date), value: d.meals_reported }))}
              max={3}
              ticks={[0, 1, 2, 3]}
              unit={(v) => `${v} of 3 meals`}
              tipLabel={tipLabel}
            />
          </section>
          <section className="panel">
            {gapRows.length ? (
              <ColumnChart
                title="Pause before replying, in seconds"
                values={gapRows.map((d) => ({ day: dayNumber(d.local_date), value: Math.round((d.response_gap_ms ?? 0) / 100) / 10 }))}
                max={gapMax / 1000}
                ticks={[0, gapMax / 2000, gapMax / 1000]}
                unit={(v) => `${v} s`}
                tipLabel={tipLabel}
              />
            ) : (
              <>
                <h3>Pause before replying</h3>
                <p className="empty">No usable timing yet. Text, very short calls, and noisy calls are left out.</p>
              </>
            )}
          </section>
          <section className="panel">
            <DotChart
              title="Mood, only when it was said"
              levels={MOODS}
              values={rows.map((d) => ({ day: dayNumber(d.local_date), level: d.mood && MOODS.includes(d.mood) ? d.mood : null }))}
              emptyLabel="Not said"
              tipLabel={tipLabel}
            />
          </section>
          <section className="panel">
            <DotChart
              title="Mentioned speaking with family"
              levels={["Yes"]}
              values={rows.map((d) => ({ day: dayNumber(d.local_date), level: d.family_contact ? "Yes" : null }))}
              emptyLabel="No"
              tipLabel={tipLabel}
            />
          </section>
        </>
      ) : null}

      <section className="panel panel-wide" aria-labelledby="conv-memories">
        <h2 id="conv-memories">Memories from conversations</h2>
        {updates?.summaries.length || conversationMemories.length ? (
          <ul className="rows">
            {conversationMemories.map((m) => (
              <li key={m}>
                <span className="row-main">
                  <strong>{m}</strong>
                  <span>From a conversation</span>
                </span>
              </li>
            ))}
            {(updates?.summaries ?? []).map((s) => (
              <li key={s.session_id}>
                <span className="row-main">
                  <strong>{s.text}</strong>
                  <span>{s.date ? dateLabel(s.date) : ""} · conversation summary</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">Appears after the first conversation is processed.</p>
        )}
      </section>

      {rows.length ? (
        <details className="panel panel-wide table-view">
          <summary>Show the days as a table</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Meals</th>
                <th scope="col">Pause (s)</th>
                <th scope="col">Mood said</th>
                <th scope="col">Family contact</th>
                <th scope="col">Context</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.local_date}>
                  <td>{dateLabel(d.local_date)}</td>
                  <td>{d.meals_reported}</td>
                  <td>{d.response_gap_ms === null ? "-" : (d.response_gap_ms / 1000).toFixed(1)}</td>
                  <td>{d.mood ?? "Not said"}</td>
                  <td>{d.family_contact ? "Yes" : "No"}</td>
                  <td>{[d.is_fasting ? "Fasting" : "", d.is_ill ? "Unwell" : ""].filter(Boolean).join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {demo ? (
        <section className="panel panel-wide" aria-labelledby="demo-controls">
          <h2 id="demo-controls">Demo controls</h2>
          <ul className="rows">
            <li>
              <span className="row-main">
                <strong>Load synthetic history</strong>
                <span>Synthetic history. Sixteen labeled days go through the real BigQuery rule and the insight.</span>
              </span>
              <span className="demo-buttons">
                {(["stable", "changing", "fasting", "family"] as const).map((sc) => (
                  <button key={sc} className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void run(sc, () => seedDemoHistory(sc))}>
                    {busy === sc ? "Working..." : sc[0].toUpperCase() + sc.slice(1)}
                  </button>
                ))}
              </span>
            </li>
            <li>
              <span className="row-main">
                <strong>Run seeded session</strong>
                <span>Recorded transcript. Extraction, BigQuery, and the insight are live. No speech timing is invented.</span>
              </span>
              <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void run("seed", () => runSeededSession())}>
                {busy === "seed" ? "Working..." : "Run"}
              </button>
            </li>
            <li>
              <span className="row-main">
                <strong>Check-in with no reply</strong>
                <span>Demo clock for this synthetic household only. Two played invitations, 15 minutes, no reply.</span>
              </span>
              <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void run("un", () => simulateCheckin("unanswered"))}>
                Simulate
              </button>
            </li>
            <li>
              <span className="row-main">
                <strong>Phone unavailable</strong>
                <span>Demo clock for this synthetic household only. The app was closed or the microphone blocked.</span>
              </span>
              <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void run("dev", () => simulateCheckin("device_unavailable"))}>
                Simulate
              </button>
            </li>
          </ul>
          {note ? <p className="error">{note}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
