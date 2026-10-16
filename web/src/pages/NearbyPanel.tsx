import { useEffect, useState } from "react";
import type { NearbyItem } from "../lib/api";
import { isLateNow, locationChoice, locationMessage, shareLocationOnce } from "../lib/location";
import { LANGUAGES, type Language, type PhoneWords } from "../lib/languages";
import { useAppDispatch, useAppSelector } from "../store";
import { OPEN_NOW_FRESH_MS, loadNearby, nearbyForget, nearbyFromCache, placesAgeMs, type NearbyTab } from "../store/reads";
import { NearbyList } from "./NearbyList";

const tabs: { id: NearbyTab; word: keyof PhoneWords; en: string }[] = [
  { id: "hospital", word: "hospital", en: "Hospitals" },
  { id: "pharmacy", word: "pharmacy", en: "Medical shops" },
  { id: "people", word: "people", en: "My people" },
  { id: "park", word: "park", en: "Parks" },
  { id: "restaurant", word: "food", en: "Food" },
  { id: "helplines", word: "helplines", en: "Helplines" },
];

export type NearbyCard = { kind: string; items: NearbyItem[]; positionShared: boolean } | null;

type Props = {
  householdId: string;
  onClose: () => void;
  // A card the voice assistant just found: its tab opens first, so what Saathi said and what is on screen match.
  card?: NearbyCard;
  // The shared demo never keeps anyone's position; it looks in the demo's city.
  demo?: boolean;
  // The parent's language: shown on top of each English label. English alone shows only the English line.
  language?: Language;
};

// The parent's "Nearby help" sheet: six large buttons, then a short list with Call and Directions.
// Lists come from the store; the server (and the paid Places lookup behind it) is asked only when the copy is old.
export function NearbyPanel({ householdId, onClose, card, demo = false, language = LANGUAGES[0] }: Props) {
  const dispatch = useAppDispatch();
  const initial = tabs.find((t) => t.id === card?.kind)?.id ?? "hospital";
  const [tab, setTab] = useState<NearbyTab>(initial);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const record = useAppSelector((state) => state.reads.nearby[householdId]);
  const data = nearbyFromCache(record, tab);
  const late = isLateNow();
  const w = language.words;
  const lang = language.code.slice(0, 2);
  const twoLines = language.name !== "English";

  useEffect(() => {
    setFailed(false);
    // Late at night the park tab only says "tomorrow morning", so nothing is looked up.
    if (tab === "park" && isLateNow()) return;
    dispatch(loadNearby({ householdId, tab }))
      .unwrap()
      .catch((err: { name?: string }) => {
        // A skipped read (the copy is fresh, or the same read is already on its way) is not a failure.
        if (err?.name !== "ConditionError") setFailed(true);
      });
  }, [dispatch, householdId, tab]);

  // Escape closes the sheet, like the Close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function allowLocation() {
    setAsking(true);
    const result = await shareLocationOnce(householdId);
    setNote(locationMessage(result));
    setAsking(false);
    if (result === "saved") {
      dispatch(nearbyForget(householdId));
      void dispatch(loadNearby({ householdId, tab, force: true }));
    }
  }

  const shared = data?.location.set ?? card?.positionShared ?? false;
  const asked = locationChoice(householdId);
  const isPlace = tab !== "helplines" && tab !== "people";
  const items: NearbyItem[] = !data ? [] : tab === "helplines" ? data.helplines : tab === "people" ? data.people : data.places[tab] ?? [];
  // "Open now" from an older lookup could be wrong by now, so it is left out.
  const showOpen = isPlace && placesAgeMs(record, tab) < OPEN_NOW_FRESH_MS;
  const said = (native: string, className?: string) =>
    twoLines ? (
      <span lang={lang} className={className}>
        {native}
      </span>
    ) : null;

  return (
    <div className="nearby-sheet" role="dialog" aria-modal="true" aria-labelledby="nearby-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nearby-card">
        <span className="nearby-grip" aria-hidden="true" />
        <header className="nearby-head">
          <h2 id="nearby-title">
            {said(w.nearby)}
            <small>Nearby help</small>
          </h2>
          <button className="ghost nearby-close" type="button" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
            {said(w.close, "nearby-close-word")}
          </button>
        </header>

        <div className="nearby-tabs" role="tablist" aria-label="Kind of help">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "nearby-tab nearby-tab-on" : "nearby-tab"}
              onClick={() => setTab(t.id)}
            >
              {said(w[t.word] as string)}
              <small>{t.en}</small>
            </button>
          ))}
        </div>

        {tab === "hospital" ? (
          <p className="nearby-emergency">
            {said(w.emergency)}
            <span>
              In an emergency, call <a href="tel:112">112</a> first.
            </span>
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
            {said(w.parkLate)} It is late. A park is better in the morning.
          </p>
        ) : !data && failed ? (
          <p className="nearby-empty">
            Could not load this just now. Try again, or call <a href="tel:112">112</a> in an emergency.
          </p>
        ) : !data ? (
          <p className="nearby-empty">Looking…</p>
        ) : (
          <>
            <NearbyList
              items={showOpen ? items : items.map((item) => ({ ...item, openNow: null }))}
              directions={isPlace}
              large
              empty={
                tab === "people"
                  ? "Your family has not added anyone yet."
                  : !data.available
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
