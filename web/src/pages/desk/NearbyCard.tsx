import { useCallback, useEffect, useState } from "react";
import { deleteLocation, fetchNearby, type Nearby, type NearbyKind } from "../../lib/api";
import { NearbyList } from "../NearbyList";

const sections: { id: NearbyKind; title: string }[] = [
  { id: "hospital", title: "Hospitals" },
  { id: "pharmacy", title: "Medical shops" },
  { id: "park", title: "Parks" },
  { id: "restaurant", title: "Food" },
];

type Props = { householdId: string; name: string };

// What Saathi can offer when the parent asks for help nearby, so the family can see it and check it is sensible.
export function NearbyCard({ householdId, name }: Props) {
  const who = name || "your parent";
  const [data, setData] = useState<Nearby | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<NearbyKind>("hospital");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setError(false);
    try {
      setData(await fetchNearby(householdId, "all"));
    } catch {
      setError(true);
    }
  }, [householdId]);

  useEffect(() => {
    if (householdId) void load();
  }, [householdId, load]);

  async function forget() {
    try {
      await deleteLocation(householdId);
      setNote("The saved position is deleted.");
      await load();
    } catch {
      setNote("Could not delete it. Try again.");
    }
  }

  const city = data?.location.city;
  return (
    <section className="panel panel-wide nearby-card-desk" aria-labelledby="nearby-desk-title">
      <h2 id="nearby-desk-title">Near {who}</h2>
      <p className="panel-lede">
        {who} can ask Saathi, by voice or on the phone, for a hospital, a medical shop, a park, or somewhere to eat, and
        Saathi shows it with a Call button. Trusted contacts who live nearby come first. These are places and numbers, not
        medical advice.
      </p>
      <p className="nearby-source">
        {data?.location.set
          ? `Using ${who}'s phone position, shared once${data.location.updatedAt ? ` on ${new Date(data.location.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}.`
          : city
            ? `Using the city on the Profile tab: ${city}. Ask ${who} to tap “Allow location” on their phone for what is closest.`
            : `Add a city on the Profile tab, or ask ${who} to tap “Allow location” on their phone.`}{" "}
        {data?.location.set ? (
          <button className="text-link" type="button" onClick={() => void forget()}>
            Forget the position
          </button>
        ) : null}
      </p>
      {note ? (
        <p className="note" role="status">
          {note}
        </p>
      ) : null}

      {error ? (
        <p className="field-error" role="alert">
          Could not load this.{" "}
          <button className="text-link" type="button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : !data ? (
        <p className="nearby-empty">Looking…</p>
      ) : (
        <>
          <div className="doc-chips" role="group" aria-label="Kind of place">
            {sections.map((s) => (
              <button key={s.id} type="button" aria-pressed={open === s.id} className={open === s.id ? "doc-chip doc-chip-on" : "doc-chip"} onClick={() => setOpen(s.id)}>
                {s.title} {data.places[s.id]?.length ?? 0}
              </button>
            ))}
          </div>
          <NearbyList
            items={data.places[open] ?? []}
            directions
            empty={data.available ? "Nothing found." : "Saathi could not look this up just now. The helplines and trusted contacts below still work."}
          />
          <div className="nearby-two">
            <div>
              <h3>Trusted people</h3>
              <NearbyList items={data.people} empty="No trusted contacts yet. Add them in the section above." />
            </div>
            <div>
              <h3>Helplines</h3>
              <NearbyList items={data.helplines} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
