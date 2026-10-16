import { useState, type FormEvent } from "react";
import { useUndoable } from "./undo";
import { TimePicker } from "./Pickers";
import { newId, parseQuiet, type Desk, type Profile } from "../../desk";
import { LanguageOptions } from "../../lib/languages";

type Props = {
  desk: Desk;
  setDesk: React.Dispatch<React.SetStateAction<Desk>>;
  author: string;
  photo?: string | null;
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function text(data: FormData, key: string) {
  return String(data.get(key) ?? "").trim();
}

export function ProfileTab({ desk, setDesk, author, photo }: Props) {
  const undoable = useUndoable();
  const [saved, setSaved] = useState("");
  const [profileError, setProfileError] = useState("");
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);

  const p = desk.profile;
  const quiet = parseQuiet(p.quietHours);

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = text(data, "quietFrom");
    const to = text(data, "quietTo");
    if (Boolean(from) !== Boolean(to)) {
      setProfileError("Set both a start and an end for quiet hours, or leave both empty.");
      return;
    }
    const profile: Profile = {
      preferredName: text(data, "preferredName"),
      language: text(data, "language") || "Hindi",
      city: text(data, "city"),
      persona: data.get("persona") === "Rakshak" ? "Rakshak" : "Saathi",
      checkIn: text(data, "checkIn"),
      // Keep older free text if the time pickers were left empty.
      quietHours: from && to ? `${from}-${to}` : quiet ? "" : p.quietHours,
    };
    setDesk((d) => ({ ...d, profile }));
    setProfileError("");
    setSaved("Saved in this browser.");
  }

  function addPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = text(data, "name");
    if (!name) return;
    const person = { id: newId(), name, relation: text(data, "relation"), city: text(data, "city") };
    setDesk((d) => ({ ...d, people: [...d.people, person] }));
    form.reset();
  }

  function savePerson(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = text(data, "name");
    if (!name) return;
    setDesk((d) => ({
      ...d,
      people: d.people.map((x) => (x.id === id ? { ...x, name, relation: text(data, "relation"), city: text(data, "city") } : x)),
    }));
    setEditingPerson(null);
  }

  function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = text(new FormData(form), "memory");
    if (!value) return;
    const memory = { id: newId(), text: value, author, addedAt: new Date().toISOString() };
    setDesk((d) => ({ ...d, memories: [memory, ...d.memories] }));
    form.reset();
  }

  function saveMemory(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const value = text(new FormData(event.currentTarget), "memory");
    if (!value) return;
    setDesk((d) => ({
      ...d,
      memories: d.memories.map((m) => (m.id === id ? { ...m, text: value, editedAt: new Date().toISOString() } : m)),
    }));
    setEditingMemory(null);
  }

  return (
    <div className="tab-grid">
      <section className="panel" aria-labelledby="person-title">
        <h2 id="person-title">This person</h2>
        <p className="panel-lede">How Saathi greets them, and when it checks in.</p>
        {photo ? <img className="person-portrait" src={photo} alt={p.preferredName || "Profile photo"} width={864} height={1152} /> : null}
        <form className="form-grid" onSubmit={saveProfile} onChange={() => setSaved("")}>
          <label className="field">
            Preferred name
            <input name="preferredName" defaultValue={p.preferredName} required autoComplete="off" />
          </label>
          <label className="field">
            City
            <input name="city" defaultValue={p.city} placeholder="Not set" autoComplete="address-level2" />
          </label>
          <label className="field">
            Language
            <select name="language" defaultValue={p.language}>
              <LanguageOptions />
            </select>
          </label>
          <label className="field">
            Persona
            <select name="persona" defaultValue={p.persona}>
              <option value="Saathi">Saathi, warm companion</option>
              <option value="Rakshak">Rakshak, shorter, meals and reminders</option>
            </select>
          </label>
          <label className="field">
            Daily check-in
            <TimePicker name="checkIn" defaultValue={p.checkIn} label="Daily check-in" placeholder="Not set" />
          </label>
          <fieldset className="field quiet">
            <legend>Quiet hours</legend>
            <div className="quiet-row">
              <TimePicker name="quietFrom" label="Quiet hours start" defaultValue={quiet?.[0] ?? ""} placeholder="From" />
              <span aria-hidden="true">to</span>
              <TimePicker name="quietTo" label="Quiet hours end" defaultValue={quiet?.[1] ?? ""} placeholder="To" />
            </div>
            {!quiet && p.quietHours ? <span className="hint">Currently: {p.quietHours}</span> : null}
          </fieldset>
          {profileError ? (
            <p className="field-error form-span" role="alert">
              {profileError}
            </p>
          ) : null}
          <div className="form-end">
            <button className="primary" type="submit">
              Save
            </button>
            <span role="status" className="saved">
              {saved}
            </span>
          </div>
        </form>
      </section>

      <section className="panel" aria-labelledby="people-title">
        <h2 id="people-title">People who matter</h2>
        <p className="panel-lede">Saathi may ask about one of them, like a friend would.</p>
        {desk.people.length ? (
          <ul className="rows card-list">
            {desk.people.map((person) =>
              editingPerson === person.id ? (
                <li key={person.id} className="row-editing">
                  <form className="edit-form" onSubmit={(event) => savePerson(event, person.id)}>
                    <input name="name" aria-label="Name" defaultValue={person.name} required autoFocus />
                    <input name="relation" aria-label="Relation" defaultValue={person.relation} placeholder="Relation" />
                    <input name="city" aria-label="City" defaultValue={person.city} placeholder="City" />
                    <div className="edit-actions">
                      <button className="primary" type="submit">
                        Save
                      </button>
                      <button className="ghost" type="button" onClick={() => setEditingPerson(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={person.id}>
                  <span className="row-avatar" aria-hidden="true">
                    {person.name.charAt(0)}
                  </span>
                  <span className="row-main">
                    <strong>{person.name}</strong>
                    <span>{[person.relation, person.city].filter(Boolean).join(" · ") || "No details"}</span>
                  </span>
                  <span className="row-buttons">
                    <button className="text-link row-edit" type="button" onClick={() => setEditingPerson(person.id)}>
                      Edit<span className="visually-hidden"> {person.name}</span>
                    </button>
                    <button
                      className="text-link row-remove"
                      type="button"
                      onClick={() => {
                        undoable(person.name);
                        setDesk((d) => ({ ...d, people: d.people.filter((x) => x.id !== person.id) }));
                      }}
                    >
                      Remove<span className="visually-hidden"> {person.name}</span>
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="empty">No one added yet.</p>
        )}
        <form className="add-form" onSubmit={addPerson}>
          <p className="add-title">Add a person</p>
          <div className="add-grid">
            <input name="name" aria-label="Name" placeholder="Name" required />
            <input name="relation" aria-label="Relation" placeholder="Relation" />
            <input name="city" aria-label="City" placeholder="City" />
            <button className="ghost" type="submit">
              Add
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel-wide" aria-labelledby="memories-title">
        <h2 id="memories-title">Memories you have added</h2>
        <p className="panel-lede">Short facts. The next conversation may use them. Delete one and Saathi stops using it.</p>
        <form className="memory-form" onSubmit={addMemory}>
          <textarea name="memory" aria-label="New memory" rows={2} placeholder="She likes the temple garden." required />
          <button className="primary" type="submit">
            Add memory
          </button>
        </form>
        {desk.memories.length ? (
          <ul className="rows card-list">
            {desk.memories.map((memory) =>
              editingMemory === memory.id ? (
                <li key={memory.id} className="row-editing">
                  <form className="memory-form" onSubmit={(event) => saveMemory(event, memory.id)}>
                    <textarea name="memory" aria-label="Edit memory" rows={2} defaultValue={memory.text} required autoFocus />
                    <div className="edit-actions">
                      <button className="primary" type="submit">
                        Save
                      </button>
                      <button className="ghost" type="button" onClick={() => setEditingMemory(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={memory.id}>
                  <span className="row-main">
                    <strong>{memory.text}</strong>
                    <span>
                      Added by {memory.author}, {formatWhen(memory.addedAt)}
                      {memory.editedAt ? ` · edited ${formatWhen(memory.editedAt)}` : ""}
                    </span>
                  </span>
                  <span className="row-buttons">
                    <button className="text-link row-edit" type="button" onClick={() => setEditingMemory(memory.id)}>
                      Edit<span className="visually-hidden"> memory</span>
                    </button>
                    <button
                      className="text-link row-remove"
                      type="button"
                      onClick={() => {
                        undoable("the memory");
                        setDesk((d) => ({ ...d, memories: d.memories.filter((x) => x.id !== memory.id) }));
                      }}
                    >
                      Delete<span className="visually-hidden"> memory</span>
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="empty">None yet.</p>
        )}
      </section>
    </div>
  );
}
