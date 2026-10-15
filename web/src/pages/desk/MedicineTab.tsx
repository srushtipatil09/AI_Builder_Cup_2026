import { useState, type FormEvent } from "react";
import { formatClock, formatDate, newId, readBack, today, type Desk, type Medicine } from "../../desk";

type Props = {
  desk: Desk;
  setDesk: React.Dispatch<React.SetStateAction<Desk>>;
  name: string;
  author: string;
};

type Draft = Omit<Medicine, "id" | "confirmedOn" | "confirmedBy">;

const empty: Draft = { name: "", dose: "", schedule: "Daily", date: "", time: "", note: "" };

function text(data: FormData, key: string) {
  return String(data.get(key) ?? "").trim();
}

function toDraft(data: FormData): Draft {
  const schedule = data.get("schedule") === "Once" ? "Once" : "Daily";
  return {
    name: text(data, "name"),
    dose: text(data, "dose"),
    schedule,
    date: schedule === "Once" ? text(data, "date") : "",
    time: text(data, "time"),
    note: text(data, "note"),
  };
}

// One form for adding and editing. A missing time or date is a question, not a guess, so both are required.
function ReminderFields({ value, onSchedule }: { value: Draft; onSchedule: (s: Draft["schedule"]) => void }) {
  return (
    <>
      <label className="field form-span">
        Medicine name
        <input name="name" required defaultValue={value.name} placeholder="As written on the strip" />
      </label>
      <label className="field form-span">
        Dose, as the doctor wrote it
        <input name="dose" defaultValue={value.dose} placeholder="Copied from the prescription" />
      </label>
      <label className="field">
        How often
        <select
          name="schedule"
          defaultValue={value.schedule}
          onChange={(event) => onSchedule(event.target.value === "Once" ? "Once" : "Daily")}
        >
          <option value="Daily">Every day</option>
          <option value="Once">Once</option>
        </select>
      </label>
      {value.schedule === "Once" ? (
        <label className="field">
          Date
          <input name="date" type="date" required min={today()} defaultValue={value.date} />
        </label>
      ) : null}
      <label className="field">
        Time
        <input name="time" type="time" required defaultValue={value.time} />
      </label>
      <label className="field form-span">
        Note for Saathi to say
        <input name="note" defaultValue={value.note} placeholder="e.g. after breakfast" />
      </label>
    </>
  );
}

export function MedicineTab({ desk, setDesk, name, author }: Props) {
  const who = name || "the parent";
  const [draft, setDraft] = useState<Draft>(empty);
  const [pending, setPending] = useState<Draft | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editSchedule, setEditSchedule] = useState<Draft["schedule"]>("Daily");
  const [added, setAdded] = useState("");
  const stamp = today();

  // Step one: read the reminder back. Nothing is saved yet.
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = toDraft(new FormData(event.currentTarget));
    setDraft(next);
    setPending(next);
    setAdded("");
  }

  // Step two: an explicit confirm saves it.
  function confirmAdd() {
    if (!pending) return;
    setDesk((d) => ({ ...d, medicines: [...d.medicines, { id: newId(), ...pending }] }));
    setAdded(`Saved: ${pending.name}.`);
    setPending(null);
    setDraft(empty);
    setFormKey((k) => k + 1);
  }

  function saveEdit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const next = toDraft(new FormData(event.currentTarget));
    setDesk((d) => ({ ...d, medicines: d.medicines.map((m) => (m.id === id ? { ...m, ...next } : m)) }));
    setEditing(null);
  }

  function setConfirmed(id: string, on: boolean) {
    setDesk((d) => ({
      ...d,
      medicines: d.medicines.map((m) =>
        m.id === id ? { ...m, confirmedOn: on ? stamp : undefined, confirmedBy: on ? author : undefined } : m,
      ),
    }));
  }

  const sorted = [...desk.medicines].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="tab-grid">
      <section className="panel" aria-labelledby="add-med">
        <h2 id="add-med">Add a medicine reminder</h2>
        <p className="panel-lede">
          Type it the way the prescription or the strip says. Saathi reads it back exactly as written and never
          suggests a dose.
        </p>

        {pending ? (
          <div className="readback" role="region" aria-labelledby="readback-title">
            <p id="readback-title" className="readback-label">
              Saathi will say
            </p>
            <p className="readback-text">&ldquo;{readBack(pending)}&rdquo;</p>
            <p className="readback-ask">Save this reminder?</p>
            <div className="edit-actions">
              <button className="primary" type="button" onClick={confirmAdd}>
                Confirm and save
              </button>
              <button className="ghost" type="button" onClick={() => setPending(null)}>
                Change it
              </button>
            </div>
          </div>
        ) : (
          <form key={formKey} className="form-grid" onSubmit={review}>
            <ReminderFields value={draft} onSchedule={(schedule) => setDraft((d) => ({ ...d, schedule }))} />
            <div className="form-end">
              <button className="primary" type="submit">
                Review reminder
              </button>
              <span role="status" className="saved">
                {added}
              </span>
            </div>
          </form>
        )}
      </section>

      <section className="panel" aria-labelledby="med-list">
        <h2 id="med-list">Reminders</h2>
        <p className="panel-lede">
          The status is what {who} reports, or what you record after checking with {who}. &ldquo;I don&rsquo;t
          remember&rdquo; stays not yet confirmed.
        </p>
        {sorted.length ? (
          <ul className="rows">
            {sorted.map((m) => {
              const confirmed = m.confirmedOn === stamp;
              if (editing === m.id) {
                return (
                  <li key={m.id} className="row-editing">
                    <form className="form-grid edit-grid" onSubmit={(event) => saveEdit(event, m.id)}>
                      <ReminderFields value={{ ...m, schedule: editSchedule }} onSchedule={setEditSchedule} />
                      <div className="edit-actions form-span">
                        <button className="primary" type="submit">
                          Save
                        </button>
                        <button className="ghost" type="button" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </li>
                );
              }
              return (
                <li key={m.id} className="med-row">
                  <span className="row-avatar row-avatar-time" aria-hidden="true">
                    {formatClock(m.time)}
                  </span>
                  <span className="row-main">
                    <strong>{m.name}</strong>
                    <span>
                      {[m.dose, m.schedule === "Once" && m.date ? `Once, ${formatDate(m.date)}` : "Every day", m.note]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className={confirmed ? "status-chip status-chip-ok" : "status-chip"}>
                      {confirmed ? `Confirmed today · ${m.confirmedBy ?? ""}`.replace(/ · $/, "") : "Not yet confirmed"}
                    </span>
                  </span>
                  <span className="row-buttons">
                    <button className="text-link row-edit" type="button" onClick={() => setConfirmed(m.id, !confirmed)}>
                      {confirmed ? "Undo" : "Mark confirmed"}
                      <span className="visually-hidden"> {m.name}</span>
                    </button>
                    <button
                      className="text-link row-edit"
                      type="button"
                      onClick={() => {
                        setEditSchedule(m.schedule);
                        setEditing(m.id);
                      }}
                    >
                      Edit<span className="visually-hidden"> {m.name}</span>
                    </button>
                    <button
                      className="text-link row-remove"
                      type="button"
                      onClick={() => setDesk((d) => ({ ...d, medicines: d.medicines.filter((x) => x.id !== m.id) }))}
                    >
                      Delete<span className="visually-hidden"> {m.name}</span>
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty">No reminders yet.</p>
        )}
        <p className="note">Saved in this browser. Spoken reminders arrive when the voice connection is live.</p>
      </section>
    </div>
  );
}
