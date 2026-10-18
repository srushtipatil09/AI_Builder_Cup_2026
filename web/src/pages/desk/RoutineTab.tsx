import { useEffect, useRef, useState } from "react";
import { ackAlert, runSeededSession, seedDemoHistory, simulateCheckin, type DailyRow, type FamilyCard } from "../../lib/api";
import { enableCaretakerPush, pushMessage } from "../../lib/push";
import type { UpdatesState } from "../../lib/useUpdates";
import type { Contact } from "../../desk";
import { StaticDemoRoutine, type Props } from "./DailyTab";
import { ColumnChart, DotChart } from "./charts";
import { UrgentReminders } from "./UrgentReminders";
import { paceComparison } from "../../lib/languages";
import { telHref } from "../NearbyList";
import { useToast } from "../../toast";

type LiveProps = Props & {
  householdId: string;
  state: UpdatesState;
  conversationMemories: string[];
  contacts: Contact[];
  language?: string;
};

function dayNumber(date: string) {
  return Number(date.slice(8, 10));
}

function dateLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function evidenceLine(id: string, rows: DailyRow[], card: FamilyCard | null): string {
  if (id.startsWith("daily:")) {
    const date = id.slice("daily:".length);
    const row = rows.find((item) => item.local_date === date);
    const bits = [dateLabel(date)];
    if (row?.response_gap_ms != null) bits.push(`pause ${(row.response_gap_ms / 1000).toFixed(1)} s`);
    if (row?.speaking_rate_wpm != null) bits.push(`${Math.round(row.speaking_rate_wpm)} words a minute`);
    return bits.join(", ");
  }
  if (card && id === "seed-family-2") return `${dateLabel(card.earlier_date)}: “${card.earlier_quote}”`;
  if (card && id === "seed-family-12") return `${dateLabel(card.later_date)}: “${card.later_quote}”`;
  return id;
}

function comparisonSentence(rows: DailyRow[], language: string | undefined): { en: string; local: { text: string; code: string } | null } | null {
  const paced = rows.filter((day) => day.response_gap_ms != null && day.speaking_rate_wpm != null);
  if (paced.length < 8) return null;
  const earlier = paced.slice(0, -3);
  const recentDays = paced.slice(-3);
  const mean = (group: DailyRow[], pick: (day: DailyRow) => number) => group.reduce((sum, day) => sum + pick(day), 0) / group.length;
  const earlierPause = mean(earlier, (day) => (day.response_gap_ms ?? 0) / 1000).toFixed(1);
  const recentPause = mean(recentDays, (day) => (day.response_gap_ms ?? 0) / 1000).toFixed(1);
  const earlierPace = Math.round(mean(earlier, (day) => day.speaking_rate_wpm ?? 0));
  const recentPace = Math.round(mean(recentDays, (day) => day.speaking_rate_wpm ?? 0));
  return {
    en: `Earlier days: about ${earlierPause} seconds before a reply, and about ${earlierPace} words a minute. These three days: about ${recentPause} seconds, and about ${recentPace} words a minute.`,
    local: paceComparison(language, { earlierPause, earlierPace, recentPause, recentPace }),
  };
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
  const { demo, name, medicines, onOpenReminders, householdId, state, conversationMemories, contacts, language } = props;
  const { updates, metrics, error, loadedAt, refresh } = state;
  const [busy, setBusy] = useState("");
  const toast = useToast();
  const who = name || "the parent";
  const seeded = useRef(false);

  // The shared demo household starts with the labeled synthetic history, so a reviewer does not face an empty desk.
  useEffect(() => {
    if (demo && metrics && metrics.days.length === 0 && !seeded.current) {
      seeded.current = true;
      void seedDemoHistory("story").then(refresh).catch(() => {});
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
    try {
      await action();
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That did not work.", "bad");
    } finally {
      setBusy("");
    }
  }

  const recent = rows.slice(-3);
  const meals = recent.reduce((sum, d) => sum + (d.meals_reported ?? 0), 0);
  const lastContact = [...rows].reverse().find((d) => d.family_contact)?.local_date;
  const gapRows = rows.filter((d) => d.response_gap_ms !== null);
  const gapMax = Math.max(1000, ...gapRows.map((d) => Math.ceil((d.response_gap_ms ?? 0) / 500) * 500));
  const paceRows = rows.filter((d) => d.speaking_rate_wpm !== null);
  const paceMax = Math.max(160, ...paceRows.map((d) => Math.ceil((d.speaking_rate_wpm ?? 0) / 20) * 20));
  const fastingNoted = recent.some((d) => d.is_fasting) && drift?.meal_followup !== true;
  const nearby = contacts.find((c) => c.local) ?? null;
  const showTonight = Boolean(drift?.is_candidate) || (updates?.alerts ?? []).some((a) => a.tier >= 3);
  const comparison = comparisonSentence(rows, language);

  return (
    <div className="tab-grid">
      <UrgentReminders medicines={medicines} name={name} onOpen={onOpenReminders} />

      {(updates?.alerts ?? []).filter((a) => a.tier >= 3 || !(insight || card)).map((a) => (
        <section key={a.id} className={`panel panel-wide alert-card alert-compact alert-tier-${a.tier}`} role="alert">
          <div className="alert-text">
            <h2>{a.tier >= 3 ? "Needs your attention now" : a.tier === 2 ? "New update" : "Note"}</h2>
            <p>{a.message}</p>
            <p className="alert-meta">
              {ago(a.created_at)} · Suggested: {a.action}
              {a.evidence_ids?.length ? ` · ${a.evidence_ids.length} record${a.evidence_ids.length === 1 ? "" : "s"}` : ""}
              {a.tier >= 3 ? ` · If you cannot reach ${who}, contact local emergency services.` : ""}
            </p>
          </div>
          <button className="ghost" type="button" onClick={() => void run("ack", () => ackAlert(householdId, a.id))}>
            Mark as seen
          </button>
        </section>
      ))}

      {synthetic ? (
        <p className="synthetic panel-wide">
          <strong>Demo Preview.</strong> Showing sample routine activity for demonstration.
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
            <div className="alert-meta">
              <p>
                {insight.tier >= 2 ? "Suggested next step: " : ""}
                {insight.suggested_action}
                {insight.created_at ? ` · ${ago(insight.created_at)}` : ""}
              </p>
              {insight.evidence_ids?.length ? (
                <details className="evidence-list">
                  <summary>
                    Based on {insight.evidence_ids.length} stored record{insight.evidence_ids.length === 1 ? "" : "s"}
                  </summary>
                  <ul>
                    {insight.evidence_ids.map((id) => (
                      <li key={id}>{evidenceLine(id, rows, card)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
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

      {showTonight ? (
        <section className="panel panel-wide alert-card" aria-labelledby="tonight-title">
          <h2 id="tonight-title">Tonight</h2>
          <p>
            If someone needs to be with {who} now, call from this phone. Saathi does not place the call, and this is not a diagnosis.
          </p>
          <ul className="rows">
            <li>
              <span className="row-main">
                <strong>112</strong>
                <span>Emergency</span>
              </span>
              <a className="primary" href="tel:112">Call 112</a>
            </li>
            <li>
              <span className="row-main">
                <strong>Elderline 14567</strong>
                <span>Helpline for older people</span>
              </span>
              <a className="primary" href="tel:14567">Call Elderline</a>
            </li>
            <li>
              <span className="row-main">
                <strong>{nearby ? nearby.name : "Someone who lives nearby"}</strong>
                <span>{nearby ? nearby.relation : "No nearby contact is saved yet"}</span>
              </span>
              {nearby?.phone.trim() ? (
                <a className="primary" href={telHref(nearby.phone)}>Call {nearby.name}</a>
              ) : (
                <span className="alert-meta">Add their number under Trusted Contacts.</span>
              )}
            </li>
          </ul>
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
          {updates && updates.sessionsProcessed > 0
            ? ` · ${updates.sessionsProcessed} conversation${updates.sessionsProcessed === 1 ? "" : "s"}`
            : ""}
        </p>
        <p>
          <button
            className="ghost"
            type="button"
            onClick={() =>
              void enableCaretakerPush(householdId).then((r) => toast(pushMessage(r), r === "on" ? "ok" : r === "error" ? "bad" : "info"))
            }
          >
            Notify me on this device
          </button>{" "}
          <span className="alert-meta">Alerts always show here. A push says only “New Saathi update”.</span>
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
              <span className="tile-label">Days with conversation history</span>
              <span className="tile-value">
                {rows.length} <small>of 14</small>
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">Last mentioned family contact</span>
              <span className="tile-value">{lastContact ? dateLabel(lastContact) : "Not yet"}</span>
            </div>
          </section>

          <section className="panel panel-wide">
            <ColumnChart
              title="Meals mentioned each day"
              values={rows.map((d) => ({ day: dayNumber(d.local_date), value: d.meals_reported }))}
              max={3}
              ticks={[0, 1, 2, 3]}
              unit={(v) => `${v} of 3 meals`}
              tipLabel={tipLabel}
            />
            {fastingNoted ? (
              <p className="alert-meta">A stated fast is not treated as a missed meal, so these days do not raise the meal follow-up.</p>
            ) : null}
          </section>
          {comparison ? (
            <section className="panel panel-wide">
              <h3>Compared with their own earlier days</h3>
              <p>{comparison.en}</p>
              {comparison.local ? <p lang={comparison.local.code}>{comparison.local.text}</p> : null}
            </section>
          ) : null}
          <section className="panel">
            {gapRows.length ? (
              <>
                <ColumnChart
                  title="Pause before replying, in seconds"
                  values={gapRows.map((d) => ({ day: dayNumber(d.local_date), value: Math.round((d.response_gap_ms ?? 0) / 100) / 10 }))}
                  max={gapMax / 1000}
                  ticks={[0, gapMax / 2000, gapMax / 1000]}
                  unit={(v) => `${v} s`}
                  tipLabel={tipLabel}
                />
                <p className="alert-meta">Same person as the pace chart. A longer pause is compared with their own earlier days.</p>
              </>
            ) : (
              <>
                <h3>Pause before replying</h3>
                <p className="empty">No usable timing yet. Text, very short calls, and noisy calls are left out.</p>
              </>
            )}
          </section>
          <section className="panel">
            {paceRows.length ? (
              <>
                <ColumnChart
                  title="Speaking pace, words per minute"
                  values={paceRows.map((d) => ({ day: dayNumber(d.local_date), value: Math.round(d.speaking_rate_wpm ?? 0) }))}
                  max={paceMax}
                  ticks={[0, paceMax / 2, paceMax]}
                  unit={(v) => `${v} words per minute`}
                  tipLabel={tipLabel}
                />
                <p className="alert-meta">Same days as the pause chart. A slower pace is compared with their own earlier days.</p>
              </>
            ) : (
              <>
                <h3>Speaking pace, words per minute</h3>
                <p className="empty">Pace appears after a conversation with enough of the parent&rsquo;s own words. It is compared with their earlier days, beside the pause chart.</p>
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
        {updates?.summaries?.length || conversationMemories.length ? (
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
                <th scope="col">Pace (wpm)</th>
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
                  <td>{d.speaking_rate_wpm === null ? "-" : Math.round(d.speaking_rate_wpm)}</td>
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
                <strong>Load sample routine</strong>
                <span>Story loads slower speech and the two quotes about Rahul together. The others load one change at a time.</span>
              </span>
              <span className="demo-buttons">
                {(["story", "stable", "changing", "fasting", "family"] as const).map((sc) => (
                  <button key={sc} className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void run(sc, () => seedDemoHistory(sc))}>
                    {busy === sc ? "Working..." : sc[0].toUpperCase() + sc.slice(1)}
                  </button>
                ))}
              </span>
            </li>
            <li>
              <span className="row-main">
                <strong>Run sample conversation</strong>
                <span>Replay a sample conversation to see live memory updates.</span>
              </span>
              <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void run("seed", () => runSeededSession())}>
                {busy === "seed" ? "Working..." : "Run"}
              </button>
            </li>
            <li>
              <span className="row-main">
                <strong>Check-in during quiet hours</strong>
                <span>This demo keeps 1 pm to 3 pm quiet. A check-in at 2 pm does not start.</span>
              </span>
              <button
                className="ghost"
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("quiet", async () => {
                    const result = await simulateCheckin("quiet");
                    toast(result.label, "ok");
                  })
                }
              >
                {busy === "quiet" ? "Working..." : "Try 2 pm"}
              </button>
            </li>
            <li>
              <span className="row-main">
                <strong>Check-in with no reply</strong>
                <span>Preview an alert when a scheduled check-in gets no response after 15 minutes.</span>
              </span>
              <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void run("un", () => simulateCheckin("unanswered"))}>
                Simulate
              </button>
            </li>
            <li>
              <span className="row-main">
                <strong>Phone unavailable</strong>
                <span>Preview notification when the phone is unreachable or app is closed.</span>
              </span>
              <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void run("dev", () => simulateCheckin("device_unavailable"))}>
                Simulate
              </button>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
