import { useCallback, useEffect, useRef, useState } from "react";
import { deleteLocation, fetchOuting, type NearbyKind, type Outing } from "../../lib/api";
import { useAppDispatch, useAppSelector } from "../../store";
import { loadNearby, nearbyAllFromCache, nearbyForget, nearbyFromCache } from "../../store/reads";
import { NearbyList } from "../NearbyList";
import { useToast } from "../../toast";

const sections: { id: NearbyKind; title: string }[] = [
  { id: "hospital", title: "Hospitals" },
  { id: "pharmacy", title: "Medical shops" },
  { id: "grocery", title: "Grocery stores" },
  { id: "park", title: "Parks" },
  { id: "restaurant", title: "Food" },
];

// city and contacts come from the desk on this page: when the caretaker changes them, only that part is read again.
type Props = { householdId: string; name: string; city?: string; contactsKey?: string };

// What Saathi can offer when the parent asks for help nearby, so the family can see it and check it is sensible.
export function NearbyCard({ householdId, name, city: deskCity = "", contactsKey = "" }: Props) {
  const who = name || "your parent";
  const dispatch = useAppDispatch();
  const record = useAppSelector((state) => state.reads.nearby[householdId]);
  // Places stay on screen while only the people list is being read again.
  const data = nearbyAllFromCache(record) ?? nearbyFromCache(record, "people");
  const [error, setError] = useState(false);
  const [outing, setOuting] = useState<Outing | null>(null);
  const [open, setOpen] = useState<NearbyKind>("hospital");
  const toast = useToast();

  const load = useCallback(
    (tab: "all" | "people" = "all", force = false) => {
      setError(false);
      dispatch(loadNearby({ householdId, tab, force }))
        .unwrap()
        .catch((err: { name?: string }) => {
          if (err?.name !== "ConditionError") setError(true);
        });
    },
    [dispatch, householdId],
  );

  useEffect(() => {
    if (householdId) load();
  }, [householdId, load]);

  useEffect(() => {
    if (!householdId) return;
    void fetchOuting(householdId).then(setOuting).catch(() => setOuting(null));
  }, [householdId]);

  // A new city (with no shared position) means new places; a changed contact list only means new people.
  const seen = useRef({ city: deskCity, contactsKey });
  useEffect(() => {
    const before = seen.current;
    seen.current = { city: deskCity, contactsKey };
    if (!householdId) return;
    if (before.city !== deskCity && !record?.location?.set) {
      dispatch(nearbyForget(householdId));
      load("all", true);
    } else if (before.contactsKey !== contactsKey) {
      load("people", true);
    }
  }, [deskCity, contactsKey, householdId, record?.location?.set, dispatch, load]);

  async function forget() {
    try {
      await deleteLocation(householdId);
      toast("The saved position is deleted.", "ok");
      dispatch(nearbyForget(householdId));
      load("all", true);
    } catch {
      toast("Could not delete it. Try again.", "bad");
    }
  }

  const city = data?.location.city;
  return (
    <section className="panel panel-wide nearby-card-desk" aria-labelledby="nearby-desk-title">
      <h2 id="nearby-desk-title">Near {who}</h2>
      <p className="panel-lede">
        {who} can ask Saathi, by voice or on the phone, for a hospital, a medical shop, a grocery store, a park, or somewhere to eat, and
        Saathi shows it with a Call button. A list they open on the phone is kept here. Trusted contacts who live nearby come first. These are places and numbers, not
        medical advice.
      </p>
      {outing?.invitation ? <p className="outing-chip">{outing.invitation}</p> : null}
      {outing?.asked?.name ? (
        <p className="nearby-source">
          {who} asked for a {outing.asked.query}. Nearest: {outing.asked.name}.
        </p>
      ) : null}
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

      {error ? (
        <p className="field-error" role="alert">
          Could not load this.{" "}
          <button className="text-link" type="button" onClick={() => load("all", true)}>
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
          {data.checked?.[open] ? (
            <p className="nearby-source">
              {who} opened this list on the phone
              {` on ${new Date(data.checked[open]).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}.
            </p>
          ) : null}
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
