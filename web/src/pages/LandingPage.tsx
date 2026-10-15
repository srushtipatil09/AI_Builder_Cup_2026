import { useEffect } from "react";
import { Link } from "react-router-dom";
import { SiteFrame } from "./SiteFrame";

const promises = [
  {
    mark: "१",
    title: "Saathi speaks first",
    body: "The check-in arrives as a notification. Once the app opens, Saathi says hello. No wake word, no form.",
  },
  {
    mark: "२",
    title: "It remembers the family",
    body: "Names, cities, and small facts the family stores come back in the next greeting.",
  },
  {
    mark: "३",
    title: "The child hears what changed",
    body: "The care desk shows what is different from the usual days. It does not give a health score.",
  },
];

const day = [
  { label: "Greeting", text: "A greeting that can use a memory the family stored." },
  { label: "News", text: "News of the people who matter, a meal, and how the day felt." },
  { label: "Memory", text: "A fact the caretaker typed, so the next conversation is specific." },
];

export function LandingPage() {
  useEffect(() => {
    document.title = "Saathi";
  }, []);

  return (
    <SiteFrame home>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">A Hindi voice companion</p>
          <h1 id="hero-title" className="hero-title">
            <span className="display-name" lang="hi">
              साथी
            </span>
            <span className="stack-line">The call comes to her.</span>
          </h1>
          <p className="lede">
            For a parent whose family lives somewhere else. Saathi speaks first, in Hindi, so the day starts with a
            conversation instead of a form.
          </p>
          <div className="actions">
            <Link className="button button-lg" to="/app?demo=1">
              Try the Kamla Sharma demo
            </Link>
            <Link className="ghost button-lg" to="/signup">
              Create account
            </Link>
          </div>
          <p className="hero-note">No account needed for the demo. The household is synthetic.</p>
        </div>

        <figure className="hero-media">
          <img
            src="/photos/hero.jpg"
            width="864"
            height="1152"
            alt="An older woman in a mustard sari sits on a home verandah, listening."
          />
          <figcaption className="bubble bubble-saathi" aria-hidden="true">
            <span className="bubble-who">Saathi</span>
            Namaste, Kamla. Rahul phoned from Bengaluru.
          </figcaption>
          <div className="bubble bubble-parent" aria-hidden="true">
            <span className="bubble-who">Kamla</span>
            Haan. I ate rice and dal.
          </div>
        </figure>
      </section>

      <section className="promises" aria-label="What Saathi does">
        {promises.map((item) => (
          <article key={item.title} className="promise">
            <span className="promise-mark" lang="hi" aria-hidden="true">
              {item.mark}
            </span>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section id="day" className="offers" aria-labelledby="day-title">
        <header className="section-head">
          <p className="eyebrow">A day with Saathi</p>
          <h2 id="day-title" className="section-title">
            What the household gets
          </h2>
        </header>
        <article className="offer">
          <img
            src="/photos/speaks.jpg"
            width="1152"
            height="864"
            alt="An older woman speaks at her kitchen table, a phone resting beside a steel glass."
          />
          <div className="offer-text">
            <p className="offer-kicker">For the parent</p>
            <h3>Saathi speaks first</h3>
            <p>
              The greeting can use a memory the family stored. A closed app does not listen, and it does not wait for a
              wake word.
            </p>
          </div>
        </article>
        <article className="offer offer-flip">
          <img
            src="/photos/child.jpg"
            width="1152"
            height="864"
            alt="A man in a city apartment reads a message on his phone at dusk."
          />
          <div className="offer-text">
            <p className="offer-kicker">For the child</p>
            <h3>The child hears what changed</h3>
            <p>The care desk shows the change. It does not say the parent is safe, and it does not give a health score.</p>
          </div>
        </article>
      </section>

      <section className="day-band" aria-labelledby="holds-title">
        <div className="day-band-head">
          <h2 id="holds-title">What a conversation can hold</h2>
          <p>Ordinary things, said out loud, that make the next call specific to one person.</p>
        </div>
        <ol>
          {day.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <p>{item.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="story" aria-labelledby="demo-title">
        <div className="story-copy">
          <p className="eyebrow eyebrow-light">Demo household</p>
          <h2 id="demo-title">Kamla Sharma, Varanasi</h2>
          <p>
            Kamla is 78. Rahul, her son, lives in Bengaluru and is the caretaker. This household is synthetic.
          </p>
          <Link className="button button-light button-lg" to="/app?demo=1">
            Try the Kamla Sharma demo
          </Link>
        </div>
        <ol className="chat" aria-label="Sample conversation">
          <li className="chat-line">
            <span>Saathi</span>
            <p>Namaste, Kamla. Rahul phoned from Bengaluru.</p>
          </li>
          <li className="chat-line chat-line-parent">
            <span>Kamla</span>
            <p>Haan. I ate rice and dal.</p>
          </li>
        </ol>
      </section>
    </SiteFrame>
  );
}
