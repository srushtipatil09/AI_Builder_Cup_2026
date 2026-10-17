import { demoConversationMemories, demoDays, demoHighlights, type Mood } from "../../demoHistory";
import type { Medicine } from "../../desk";
import { ColumnChart, DotChart } from "./charts";
import { UrgentReminders } from "./UrgentReminders";

export type Props = {
  demo: boolean;
  name: string;
  medicines: Medicine[];
  onOpenReminders: () => void;
};

const moods: Mood[] = ["Good", "Okay", "Low"];

// The static synthetic view. RoutineTab falls back to it when the demo cannot reach the API.
export function StaticDemoRoutine({ demo, name, medicines, onOpenReminders }: Props) {
  // Urgent reminders always come first on this tab.
  const urgent = (
    <UrgentReminders medicines={medicines} name={name} onOpen={onOpenReminders} />
  );

  if (!demo) {
    return (
      <div className="tab-grid">
        {urgent}
        <section className="panel panel-wide">
          <h2>Learning usual routine</h2>
          <p className="panel-lede">
            Meals, conversation time, reported mood, and family contact appear here after the first week of
            conversations. Saathi compares {name || "the parent"} with their own usual days. There is no health score.
          </p>
        </section>
        <section className="panel panel-wide">
          <h2>Memories from conversations</h2>
          <p className="empty">Appears after the first conversation is processed.</p>
        </section>
      </div>
    );
  }

  const recent = demoDays.slice(-3);
  const meals = recent.reduce((sum, d) => sum + d.meals, 0);
  const minutes = recent.reduce((sum, d) => sum + d.minutes, 0);
  const lastContact = [...demoDays].reverse().find((d) => d.familyContact)?.day;

  return (
    <div className="tab-grid">
      {urgent}
      <p className="synthetic panel-wide">
        <strong>Synthetic history.</strong> Day 1 to Day 14 for the demo household. These are not measurements.
      </p>

      <section className="tiles panel-wide" aria-label="Last three days">
        <div className="tile">
          <span className="tile-label">Meals mentioned, last 3 days</span>
          <span className="tile-value">
            {meals} <small>of 9</small>
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Time talking, last 3 days</span>
          <span className="tile-value">
            {minutes} <small>min</small>
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Last mentioned family contact</span>
          <span className="tile-value">{lastContact ? `Day ${lastContact}` : "Not yet"}</span>
        </div>
      </section>

      <section className="panel">
        <ColumnChart
          title="Meals mentioned each day"
          values={demoDays.map((d) => ({ day: d.day, value: d.meals }))}
          max={3}
          ticks={[0, 1, 2, 3]}
          unit={(v) => `${v} of 3 meals`}
        />
      </section>
      <section className="panel">
        <ColumnChart
          title="Minutes talking with Saathi"
          values={demoDays.map((d) => ({ day: d.day, value: d.minutes }))}
          max={10}
          ticks={[0, 5, 10]}
          unit={(v) => `${v} min`}
        />
      </section>
      <section className="panel">
        <DotChart
          title="Mood, only when she said it"
          levels={moods}
          values={demoDays.map((d) => ({ day: d.day, level: d.mood }))}
          emptyLabel="Not said"
        />
      </section>
      <section className="panel">
        <DotChart
          title="Mentioned speaking with family"
          levels={["Yes"]}
          values={demoDays.map((d) => ({ day: d.day, level: d.familyContact ? "Yes" : null }))}
          emptyLabel="No"
        />
      </section>

      <section className="panel panel-wide panel-accent" aria-labelledby="family-card">
        <h2 id="family-card">Mentions of Rahul changed</h2>
        <ol className="quotes">
          {demoHighlights
            .filter((h) => h.quote.includes("Rahul") || h.day === 12)
            .map((h) => (
              <li key={h.day}>
                <span className="quote-day">Day {h.day}</span>
                <q lang="hi-Latn">{h.quote}</q>
                <span className="quote-en">{h.english}</span>
              </li>
            ))}
        </ol>
        <p>
          A call with Rahul, or time with a counsellor the family chooses, is a reasonable next step.{" "}
          <a href="tel:14567">Elderline 14567</a> is a published India helpline for older people. Confirm it serves
          the parent&rsquo;s state.
        </p>
      </section>

      <section className="panel" aria-labelledby="highlights-title">
        <h2 id="highlights-title">Highlights</h2>
        <ul className="rows">
          {demoHighlights.map((h) => (
            <li key={h.day}>
              <span className="row-main">
                <strong lang="hi-Latn">&ldquo;{h.quote}&rdquo;</strong>
                <span>
                  Day {h.day} · {h.english}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="conv-memories">
        <h2 id="conv-memories">Memories from conversations</h2>
        <ul className="rows">
          {demoConversationMemories.map((m) => (
            <li key={m.day}>
              <span className="row-main">
                <strong>{m.text}</strong>
                <span>Day {m.day} · from a conversation</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <details className="panel panel-wide table-view">
        <summary>Show the 14 days as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Meals</th>
              <th scope="col">Minutes</th>
              <th scope="col">Mood said</th>
              <th scope="col">Family contact</th>
            </tr>
          </thead>
          <tbody>
            {demoDays.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.meals}</td>
                <td>{d.minutes}</td>
                <td>{d.mood ?? "Not said"}</td>
                <td>{d.familyContact ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
