type Props = {
  demo: boolean;
  parentName?: string;
  language?: string;
};

type Row = [string, string];

type Card = {
  title: string;
  body: string;
  rows?: Row[];
  empty?: string;
  wide?: boolean;
  accent?: boolean;
};

export function CareDesk({ demo, parentName, language }: Props) {
  const person: Row[] = demo
    ? [
        ["Preferred name", "Kamla"],
        ["Language", "Hindi"],
        ["City", "Varanasi"],
        ["Persona", "Saathi, warm companion"],
        ["Check-in time", "Not set"],
        ["Quiet hours", "Not set"],
      ]
    : [
        ["Preferred name", parentName || "Not set"],
        ["Language", language || "Hindi"],
        ["City", "Not set"],
        ["Check-in time", "Not set"],
      ];

  const cards: Card[] = [
    {
      title: "This person",
      body: "Preferred name, language, city, persona, check-in time, and quiet hours.",
      rows: person,
    },
    {
      title: "People who matter",
      body: "The people Saathi may ask about, one at a time.",
      rows: demo ? [["Rahul", "Son · Bengaluru"]] : undefined,
      empty: "No one added yet.",
    },
    {
      title: "Memories you have added",
      body: "Short facts you type. The next conversation may use them.",
      empty: "None yet. Editing arrives when the API is connected.",
    },
    {
      title: "Memories from conversations",
      body: "Verified facts and the last three summaries. Read-only here.",
      empty: "Appears after the first conversation is processed.",
    },
    {
      title: "Major updates",
      body: "The latest insight, family quotes, and a call action.",
      empty: "No updates yet.",
      wide: true,
      accent: true,
    },
    {
      title: "The last 14 days",
      body: "Meals, reply pace, social contact, and reported mood. No health score.",
      empty: "Learning usual routine.",
      wide: true,
    },
    {
      title: "Reminders",
      body: "Next due time and whether it was reported done.",
      empty: "No reminders yet.",
    },
  ];

  return (
    <section className="desk-only desk" aria-labelledby="desk-title">
      <header className="desk-head">
        <p className="eyebrow">Care desk</p>
        <h1 id="desk-title">The facts that tune Saathi to one person</h1>
        <p>What you save here is labeled as yours, and the next conversation may use it.</p>
        {demo ? <p className="tag">Synthetic demo data</p> : null}
      </header>
      <div className="desk-grid">
        {cards.map((card) => (
          <article
            key={card.title}
            className={["desk-card", card.wide ? "desk-card-wide" : "", card.accent ? "desk-card-accent" : ""]
              .join(" ")
              .trim()}
          >
            <h2>{card.title}</h2>
            <p className="desk-card-body">{card.body}</p>
            {card.rows ? (
              <dl className="desk-rows">
                {card.rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="desk-empty">{card.empty}</p>
            )}
            {card.title === "Major updates" ? (
              <p className="desk-resource">
                <a href="tel:14567">Elderline 14567</a> is a published India helpline for older people. Confirm it
                serves the parent&rsquo;s state.
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
