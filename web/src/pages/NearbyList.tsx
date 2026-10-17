import type { NearbyItem } from "../lib/api";

// A phone number is safe in a tel: link only as digits and a leading plus.
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function mapsHref(item: NearbyItem): string {
  if (item.lat != null && item.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([item.name, item.address].filter(Boolean).join(" "))}`;
}

function distance(m?: number | null): string {
  if (m == null) return "";
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m away` : `${(m / 1000).toFixed(1)} km away`;
}

type Props = {
  items: NearbyItem[];
  // Places can be walked or driven to; people and helplines are only called.
  directions?: boolean;
  empty?: string;
  large?: boolean;
};

// One list for the parent's phone and the care desk: a name, a line of detail, Call, and Directions.
export function NearbyList({ items, directions = false, empty = "Nothing found.", large = false }: Props) {
  if (!items.length) return <p className="nearby-empty">{empty}</p>;
  return (
    <ul className={large ? "nearby-list nearby-large" : "nearby-list"}>
      {items.map((item) => {
        const detail = [
          item.relation,
          item.nearby ? "Lives nearby" : "",
          distance(item.distanceM),
          item.openNow === true ? "Open now" : item.openNow === false ? "Closed now" : "",
          item.note,
          item.address,
        ].filter(Boolean);
        return (
          <li key={`${item.name}-${item.phone ?? ""}`}>
            <span className="nearby-main">
              <strong>{item.name}</strong>
              {detail.length ? <span>{detail.join(" · ")}</span> : null}
            </span>
            <span className="nearby-actions">
              {item.phone ? (
                <a className="nearby-call" href={telHref(item.phone)}>
                  Call<span className="visually-hidden"> {item.name}</span>
                </a>
              ) : null}
              {directions ? (
                <a className="nearby-go" href={mapsHref(item)} target="_blank" rel="noopener noreferrer">
                  Directions<span className="visually-hidden"> to {item.name}</span>
                </a>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
