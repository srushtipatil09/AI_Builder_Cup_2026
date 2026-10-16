import { useState, type FormEvent } from "react";
import { useUndoable } from "./undo";
import { DatePicker, TimePicker } from "./Pickers";
import { useToast } from "../../toast";
import {
  formatClock,
  formatDate,
  kindOf,
  newId,
  readBack,
  reminderKinds,
  today,
  type Desk,
  type Medicine,
  type ReminderKind,
} from "../../desk";

type Props = {
  desk: Desk;
  setDesk: React.Dispatch<React.SetStateAction<Desk>>;
  name: string;
  author: string;
};

type Draft = Omit<Medicine, "id" | "confirmedOn" | "confirmedBy"> & { kind: ReminderKind };

const empty: Draft = { kind: "medicine", name: "", dose: "", schedule: "Daily", date: "", time: "", note: "" };

const kindOrder: ReminderKind[] = ["medicine", "exercise", "call", "meal", "other"];

// Simple line icons, one per kind.
const kindPaths: Record<ReminderKind, string> = {
  medicine: "M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 10l7 7",
  exercise: "M13 4a1.5 1.5 0 1 0 0 .01M9 21l2-6 3 3v3m-6-9 3-3 3 2 3 1M11 15l-1-4",
  call: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  meal: "M4 11h16a8 8 0 0 1-16 0Zm4-7c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3M16 4c0 1.5 1 1.5 1 3",
  other: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2Zm4 4h4",
};

export function KindIcon({ kind }: { kind: ReminderKind }) {
  return (
    <svg className="kind-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={kindPaths[kind]} />
    </svg>
  );
}

function text(data: FormData, key: string) {
  return String(data.get(key) ?? "").trim();
}

function toDraft(data: FormData): Draft {
  const schedule = data.get("schedule") === "Once" ? "Once" : "Daily";
  const kind = String(data.get("kind") ?? "medicine") as ReminderKind;
  return {
    kind: kindOrder.includes(kind) ? kind : "medicine",
    name: text(data, "name"),
    dose: text(data, "dose"),
    schedule,
    date: schedule === "Once" ? text(data, "date") : "",
    time: text(data, "time"),
    note: text(data, "note"),
  };
}

// One form for adding and editing. A missing time or date is a question, not a guess, so both are required.
function ReminderFields({ value, onChange }: { value: Draft; onChange: (patch: Partial<Draft>) => void }) {
  const copy = reminderKinds[value.kind];
  return (
    <>
      <fieldset className="kind-picker form-span">
        <legend>What is it for?</legend>
        <div className="kind-options">
          {kindOrder.map((kind) => (
            <label key={kind} className="kind-option">
              <input
                type="radio"
                name="kind"
                value={kind}
                checked={value.kind === kind}
                onChange={() => onChange({ kind })}
              />
              <span className={`kind-chip kind-${kind}`}>
                <KindIcon kind={kind} />
                {reminderKinds[kind].label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field form-span">
        {copy.name}
        <input name="name" required defaultValue={value.name} placeholder={copy.namePlaceholder} />
      </label>
      <label className="field form-span">
        {copy.detail}
        <input name="dose" defaultValue={value.dose} placeholder={copy.detailPlaceholder} />
      </label>
      <label className="field">
        How often
        <select
          name="schedule"
          defaultValue={value.schedule}
          onChange={(event) => onChange({ schedule: event.target.value === "Once" ? "Once" : "Daily" })}
        >
          <option value="Daily">Every day</option>
          <option value="Once">Once</option>
        </select>
      </label>
      {value.schedule === "Once" ? (
        <label className="field">
          Date
          <DatePicker name="date" required min={today()} defaultValue={value.date} label="Date" />
        </label>
      ) : null}
      <label className="field">
        Time
        <TimePicker name="time" required defaultValue={value.time} label="Time" />
      </label>
      <label className="field form-span">
        Note for Saathi to say
        <input name="note" defaultValue={value.note} placeholder={copy.notePlaceholder} />
      </label>
    </>
  );
}

export function MedicineTab({ desk, setDesk, name, author }: Props) {
  const who = name || "the parent";
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(empty);
  const [pending, setPending] = useState<Draft | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Pick<Draft, "kind" | "schedule">>({ kind: "medicine", schedule: "Daily" });
  // An edit is read back before it is saved, the same as a new reminder.
  const [editPending, setEditPending] = useState<Draft | null>(null);
  const [editValues, setEditValues] = useState<Draft | null>(null);
  const [fresh, setFresh] = useState("");
  const undoable = useUndoable();
  const stamp = today();

  // Step one: read the reminder back. Nothing is saved yet.
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = toDraft(new FormData(event.currentTarget));
    setDraft(next);
    setPending(next);
  }

  // Step two: an explicit confirm saves it.
  function confirmAdd() {
    if (!pending) return;
    const id = newId();
    setDesk((d) => ({ ...d, medicines: [...d.medicines, { id, ...pending }] }));
    highlight(id);
    toast(`Saved: ${pending.name}.`, "ok");
    setPending(null);
    setDraft({ ...empty, kind: pending.kind });
    setFormKey((k) => k + 1);
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = toDraft(new FormData(event.currentTarget));
    setEditValues(next);
    setEditPending(next);
  }

  function confirmEdit(id: string) {
    if (!editPending) return;
    const next = editPending;
    setDesk((d) => ({ ...d, medicines: d.medicines.map((m) => (m.id === id ? { ...m, ...next } : m)) }));
    closeEdit();
    highlight(id);
    toast(`Saved: ${next.name}.`, "ok");
  }

  function closeEdit() {
    setEditing(null);
    setEditPending(null);
    setEditValues(null);
  }

  // The saved card scrolls into view and glows once, so it is clear where it went.
  function highlight(id: string) {
    setFresh(id);
    window.setTimeout(() => {
      document.getElementById(`reminder-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    window.setTimeout(() => setFresh((f) => (f === id ? "" : f)), 2400);
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
        <h2 id="add-med">Add a reminder</h2>
        <p className="panel-lede">
          Medicine, a walk, a call, a meal. Saathi reads it back exactly as written. For medicine, copy the strip or
          the prescription; Saathi never suggests a dose.
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
            <ReminderFields value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
            <div className="form-end">
              <button className="primary" type="submit">
                Review reminder
              </button>
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
          <ul className="rows med-list">
            {sorted.map((m) => {
              const confirmed = m.confirmedOn === stamp;
              const kind = kindOf(m);
              if (editing === m.id) {
                return (
                  <li key={m.id} className="row-editing">
                    {editPending ? (
                      <div className="readback" role="region" aria-label="Check the change">
                        <p className="readback-label">Saathi will say</p>
                        <p className="readback-text">&ldquo;{readBack(editPending)}&rdquo;</p>
                        <p className="readback-ask">Save this change?</p>
                        <div className="edit-actions">
                          <button className="primary" type="button" onClick={() => confirmEdit(m.id)}>
                            Confirm and save
                          </button>
                          <button className="ghost" type="button" onClick={() => setEditPending(null)}>
                            Change it
                          </button>
                        </div>
                      </div>
                    ) : (
                    <form className="form-grid edit-grid" onSubmit={saveEdit}>
                      <ReminderFields
                        value={editValues ? { ...editValues, ...editDraft } : { ...m, ...editDraft }}
                        onChange={(patch) => setEditDraft((d) => ({ ...d, ...patch }))}
                      />
                      <div className="edit-actions form-span">
                        <button className="primary" type="submit">
                          Review change
                        </button>
                        <button className="ghost" type="button" onClick={closeEdit}>
                          Cancel
                        </button>
                      </div>
                    </form>
                    )}
                  </li>
                );
              }
              return (
                <li
                  key={m.id}
                  id={`reminder-${m.id}`}
                  className={["med-card", confirmed ? "med-card-ok" : "", fresh === m.id ? "med-card-new" : ""].filter(Boolean).join(" ")}
                >
                  <div className="med-card-top">
                    <span className="med-time">{formatClock(m.time)}</span>
                    <span className="med-main">
                      <span className={`kind-tag kind-${kind}`}>
                        <KindIcon kind={kind} />
                        {reminderKinds[kind].label}
                      </span>
                      <strong>{m.name}</strong>
                      <span className="med-meta">
                        {m.dose ? <span className="med-dose">{m.dose}</span> : null}
                        <span>{m.schedule === "Once" && m.date ? `Once, ${formatDate(m.date)}` : "Every day"}</span>
                      </span>
                      {m.note ? <span className="med-note">&ldquo;{m.note}&rdquo;</span> : null}
                    </span>
                    <span className={confirmed ? "status-chip status-chip-ok" : "status-chip"}>
                      {confirmed ? `Confirmed today · ${m.confirmedBy ?? ""}`.replace(/ · $/, "") : "Not yet confirmed"}
                    </span>
                  </div>
                  <div className="med-actions">
                    <button
                      className={confirmed ? "ghost med-confirm" : "ghost med-confirm med-confirm-todo"}
                      type="button"
                      onClick={() => setConfirmed(m.id, !confirmed)}
                    >
                      {confirmed ? "Undo confirmation" : "Mark confirmed"}
                      <span className="visually-hidden"> {m.name}</span>
                    </button>
                    <button
                      className="text-link row-edit"
                      type="button"
                      onClick={() => {
                        setEditDraft({ kind, schedule: m.schedule });
                        setEditPending(null);
                        setEditValues(null);
                        setEditing(m.id);
                      }}
                    >
                      Edit<span className="visually-hidden"> {m.name}</span>
                    </button>
                    <button
                      className="text-link row-remove"
                      type="button"
                      onClick={() => {
                        undoable(m.name);
                        setDesk((d) => ({ ...d, medicines: d.medicines.filter((x) => x.id !== m.id) }));
                      }}
                    >
                      Delete<span className="visually-hidden"> {m.name}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty">No reminders yet.</p>
        )}
        <p className="note">Spoken reminders arrive when the voice connection is live.</p>
      </section>
    </div>
  );
}
