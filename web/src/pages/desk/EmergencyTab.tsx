import { useState, type FormEvent } from "react";
import { newId, phoneProblem, type Contact, type Desk } from "../../desk";

type Props = {
  desk: Desk;
  setDesk: React.Dispatch<React.SetStateAction<Desk>>;
  name: string;
};

type Fields = Omit<Contact, "id">;

function read(data: FormData): Fields {
  return {
    name: String(data.get("name") ?? "").trim(),
    relation: String(data.get("relation") ?? "").trim(),
    phone: String(data.get("phone") ?? "").trim(),
    local: data.get("local") === "on",
  };
}

// The same fields for adding and editing a contact.
function ContactFields({ value, who, error }: { value?: Fields; who: string; error: string }) {
  return (
    <>
      <label className="field form-span">
        Name
        <input name="name" required defaultValue={value?.name} />
      </label>
      <label className="field">
        Relation
        <input name="relation" defaultValue={value?.relation} placeholder="Neighbour, daughter…" />
      </label>
      <label className="field">
        Phone
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={value?.phone}
          placeholder="+91 98765 43210"
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error ? (
        <p className="field-error form-span" role="alert">
          {error}
        </p>
      ) : null}
      <label className="check form-span">
        <input name="local" type="checkbox" defaultChecked={value?.local} />
        Lives nearby and can reach {who} in person
      </label>
    </>
  );
}

export function EmergencyTab({ desk, setDesk, name }: Props) {
  const who = name || "the parent";
  const [addError, setAddError] = useState("");
  const [editError, setEditError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = read(new FormData(form));
    const problem = fields.name ? phoneProblem(fields.phone) : "Enter a name.";
    setAddError(problem ?? "");
    if (problem) return;
    setDesk((d) => ({ ...d, contacts: [...d.contacts, { id: newId(), ...fields }] }));
    form.reset();
  }

  function saveContact(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const fields = read(new FormData(event.currentTarget));
    const problem = fields.name ? phoneProblem(fields.phone) : "Enter a name.";
    setEditError(problem ?? "");
    if (problem) return;
    setDesk((d) => ({ ...d, contacts: d.contacts.map((c) => (c.id === id ? { ...c, ...fields } : c)) }));
    setEditing(null);
  }

  const nearby = desk.contacts.some((c) => c.local);

  return (
    <div className="tab-grid">
      <section className="panel panel-wide panel-alert" aria-labelledby="first-title">
        <h2 id="first-title">In an emergency, call local emergency services first</h2>
        <p>
          <a className="call-big" href="tel:112">
            112
          </a>{" "}
          is India&rsquo;s emergency number. If {who} asks for help during a conversation, or a loud sound gets no
          reply, Saathi tells the people below straight away. It reports a fall only if {who} said so.
        </p>
      </section>

      <section className="panel" aria-labelledby="contacts-title">
        <h2 id="contacts-title">Trusted contacts</h2>
        <p className="panel-lede">Who Saathi tells, and who Contact family calls. Only these people.</p>
        {desk.contacts.length ? (
          <ul className="rows">
            {desk.contacts.map((c) =>
              editing === c.id ? (
                <li key={c.id} className="row-editing">
                  <form className="form-grid edit-grid" onSubmit={(event) => saveContact(event, c.id)} noValidate>
                    <ContactFields value={c} who={who} error={editError} />
                    <div className="edit-actions form-span">
                      <button className="primary" type="submit">
                        Save
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          setEditError("");
                          setEditing(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={c.id}>
                  <span className="row-avatar" aria-hidden="true">
                    {c.name.charAt(0)}
                  </span>
                  <span className="row-main">
                    <strong>{c.name}</strong>
                    <span>{[c.relation, c.phone || "Phone not set"].filter(Boolean).join(" · ")}</span>
                    {c.local ? <span className="status-chip status-chip-ok">Lives nearby</span> : null}
                  </span>
                  <span className="row-buttons">
                    {c.phone ? (
                      <a className="ghost row-call" href={`tel:${c.phone.replace(/[\s()-]/g, "")}`}>
                        Call<span className="visually-hidden"> {c.name}</span>
                      </a>
                    ) : null}
                    <button
                      className="text-link row-edit"
                      type="button"
                      onClick={() => {
                        setEditError("");
                        setEditing(c.id);
                      }}
                    >
                      {c.phone ? "Edit" : "Add phone"}
                      <span className="visually-hidden"> {c.name}</span>
                    </button>
                    <button
                      className="text-link row-remove"
                      type="button"
                      onClick={() => setDesk((d) => ({ ...d, contacts: d.contacts.filter((x) => x.id !== c.id) }))}
                    >
                      Remove<span className="visually-hidden"> {c.name}</span>
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="empty">No contacts yet.</p>
        )}
        {!nearby ? (
          <p className="hint-box">Add at least one person who lives nearby and can reach {who} in person.</p>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="add-contact">
        <h2 id="add-contact">Add a contact</h2>
        <form className="form-grid" onSubmit={addContact} noValidate>
          <ContactFields who={who} error={addError} />
          <div className="form-end">
            <button className="primary" type="submit">
              Add contact
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel-wide" aria-labelledby="helpline">
        <h2 id="helpline">Someone to talk to</h2>
        <p>
          <a href="tel:14567">Elderline 14567</a> is a published India helpline for older people. Confirm it serves
          the parent&rsquo;s state.
        </p>
      </section>
    </div>
  );
}
