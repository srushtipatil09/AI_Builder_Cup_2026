import { useEffect, useState } from "react";
import { formatClock, kindOf, reminderKinds, today, type Medicine } from "../../desk";
import { KindIcon } from "./MedicineTab";

// A reminder is urgent when it is due within the next hour, or came due in the last three hours
// and nobody has confirmed it today. A one-off reminder counts only on its own date.
// Wording never says "missed dose" and never suggests a dose.
const SOON_MIN = 60;
const RECENT_MIN = 180;

type Props = {
  medicines: Medicine[];
  name: string;
  onOpen: () => void;
  onConfirm: (id: string) => void;
};

type Urgent = { medicine: Medicine; minutes: number; label: string };

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function urgentList(medicines: Medicine[], now: Date): Urgent[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const stamp = today();
  return medicines
    .filter((m) => m.time && m.confirmedOn !== stamp)
    .filter((m) => m.schedule !== "Once" || !m.date || m.date === stamp)
    .map((medicine) => {
      const [h, m] = medicine.time.split(":").map(Number);
      const minutes = h * 60 + m - nowMin;
      const label =
        minutes > 0 ? `Due in ${minutes} min` : minutes === 0 ? "Due now" : "Not yet confirmed";
      return { medicine, minutes, label };
    })
    .filter((u) => u.minutes <= SOON_MIN && u.minutes >= -RECENT_MIN)
    .sort((a, b) => a.minutes - b.minutes);
}

export function UrgentReminders({ medicines, name, onOpen, onConfirm }: Props) {
  const now = useNow();
  const urgent = urgentList(medicines, now);
  if (!urgent.length) return null;
  const who = name || "the parent";

  return (
    <section className="urgent panel-wide" aria-labelledby="urgent-title" role="region">
      <div className="urgent-head">
        <span className="urgent-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2Zm4 4h4" />
          </svg>
        </span>
        <div>
          <h2 id="urgent-title">Needs attention now</h2>
          <p>
            {urgent.length === 1 ? "A reminder is" : `${urgent.length} reminders are`} due around now and{" "}
            {who} has not confirmed {urgent.length === 1 ? "it" : "them"} yet.
          </p>
        </div>
      </div>
      <ul className="urgent-list">
        {urgent.map(({ medicine, minutes, label }) => (
          <li key={medicine.id}>
            <span className="urgent-time">{formatClock(medicine.time)}</span>
            <span className="urgent-main">
              <strong>
                <KindIcon kind={kindOf(medicine)} />
                <span className="visually-hidden">{reminderKinds[kindOf(medicine)].label}: </span>
                {medicine.name}
              </strong>
              <span>{[medicine.dose, medicine.note].filter(Boolean).join(" · ") || "As written on the Reminders tab"}</span>
            </span>
            <span className={minutes > 0 ? "urgent-chip urgent-chip-soon" : "urgent-chip"}>{label}</span>
            <button className="primary urgent-confirm" type="button" onClick={() => onConfirm(medicine.id)}>
              Mark confirmed<span className="visually-hidden"> {medicine.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="urgent-foot">
        <button className="ghost" type="button" onClick={onOpen}>
          Open Reminders
        </button>
        <span>Mark one confirmed after you have checked with {who}. Saathi never suggests a dose.</span>
      </div>
    </section>
  );
}
