import { useCallback, useEffect, useState } from "react";
import { fetchNearby, type Nearby, type NearbyItem } from "../lib/api";
import { isLateNow, locationChoice, locationMessage, shareLocationOnce } from "../lib/location";
import { NearbyList } from "./NearbyList";

type TabId = "hospital" | "pharmacy" | "park" | "people" | "restaurant" | "helplines";

const tabs: { id: TabId; hi: string; en: string }[] = [
  { id: "hospital", hi: "अस्पताल", en: "Hospitals" },
  { id: "pharmacy", hi: "दवा की दुकान", en: "Medical shops" },
  { id: "people", hi: "अपने लोग", en: "My people" },
  { id: "park", hi: "पार्क", en: "Parks" },
  { id: "restaurant", hi: "खाना", en: "Food" },
  { id: "helplines", hi: "हेल्पलाइन", en: "Helplines" },
];

export type NearbyCard = { kind: string; items: NearbyItem[]; positionShared: boolean } | null;

type Props = {
  householdId: string;
  onClose: () => void;
  // A card the voice assistant just found: shown first, so what Saathi said and what is on screen match.
  card?: NearbyCard;
  // The shared demo never keeps anyone's position; it looks in the demo's city.
  demo?: boolean;
};

// The parent's "Nearby help" sheet: large buttons, then a short list with Call and Directions.
export function NearbyPanel({ householdId, onClose, card, demo = false }: Props) {
  const initial = (tabs.find((t) => t.id === card?.kind)?.id ?? "hospital") as TabId;
  const [tab, setTab] = useState<TabId>(initial);
  const [data, setData] = useState<Nearby | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const late = isLateNow();

  const load = useCallback(
    async (kind: TabId) => {
      setLoading(true);
      setFailed(false);
      try {
        setData(await fetchNearby(householdId, kind));
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [householdId],
  );

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  async function allowLocation() {
    setAsking(true);
    const result = await shareLocationOnce(householdId);
    setNote(locationMessage(result));
    setAsking(false);
    if (result === "saved") void load(tab);
  }

  const shared = data?.location.set ?? card?.positionShared ?? false;
  const asked = locationChoice(householdId);
  const items: NearbyItem[] =
    tab === "helplines" ? data?.helplines ?? [] : tab === "people" ? data?.people ?? [] : data?.places[tab] ?? (card?.kind === tab ? card.items : []);
  const isPlace = tab !== "helplines" && tab !== "people";

  return (
    <div className="nearby-sheet" role="dialog" aria-modal="true" aria-labelledby="nearby-title">
      <div className="nearby-card">
        <header className="nearby-head">
          <h2 id="nearby-title">
            <span lang="hi">आस-पास मदद</span>
            <small>Nearby help</small>
          </h2>
          <button className="ghost nearby-close" type="button" onClick={onClose}>
            <span lang="hi" className="control-hi">बंद करें</span>
            <span className="control-en">Close</span>
          </button>
        </header>

        <div className="nearby-tabs" role="tablist" aria-label="Kind of help">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "nearby-tab nearby-tab-on" : "nearby-tab"} onClick={() => setTab(t.id)}>
              <span lang="hi">{t.hi}</span>
              <small>{t.en}</small>
            </button>
          ))}
        </div>

        {tab === "hospital" ? (
          <p className="nearby-emergency">
            <span lang="hi">आपात स्थिति में पहले 112 पर कॉल करें।</span> In an emergency, call{" "}
            <a href="tel:112">112</a> first.
          </p>
        ) : null}

        {isPlace && !shared && !demo ? (
          <div className="nearby-ask">
            <p>
              {asked === "declined"
                ? "Location is off, so these are from your city. You can allow it any time."
                : "Allow location once so Saathi can find what is closest to you."}
            </p>
            <button className="primary" type="button" onClick={() => void allowLocation()} disabled={asking}>
              {asking ? "Asking…" : "Allow location"}
            </button>
          </div>
        ) : null}
        {note ? (
          <p className="note" role="status">
            {note}
          </p>
        ) : null}

        {tab === "park" && late ? (
          <p className="nearby-empty">
            <span lang="hi">रात हो गई है। पार्क कल सुबह।</span> It is late. A park is better in the morning.
          </p>
        ) : loading ? (
          <p className="nearby-empty">Looking…</p>
        ) : failed ? (
          <p className="nearby-empty">
            Could not load this just now. Try again, or call <a href="tel:112">112</a> in an emergency.
          </p>
        ) : (
          <>
            <NearbyList
              items={items}
              directions={isPlace}
              large
              empty={
                tab === "people"
                  ? "Your family has not added anyone yet."
                  : data && !data.available
                    ? "Saathi could not look this up just now."
                    : "Nothing found near you."
              }
            />
            {tab === "restaurant" && items.length ? (
              <p className="nearby-hint">Tap Call to ask them to send food, or ask Saathi to help.</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
