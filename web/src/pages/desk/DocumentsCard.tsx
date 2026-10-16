import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  deleteFile,
  fetchCategories,
  fileLink,
  listFiles,
  uploadFile,
  type FileCategory,
  type FileCategoryId,
  type StoredFile,
} from "../../lib/api";

type Props = {
  householdId: string;
  name: string;
  demo: boolean;
  onChanged?: () => void;
};

// Used until the API answers, so the forms are never empty. The API is the source of truth.
const FALLBACK_CATEGORIES: FileCategory[] = [
  { id: "profile_photo", title: "Profile photo", hint: "One clear, recent photo of the parent. Replaces the old one.", privateOnly: false },
  { id: "family_photos", title: "Family photos", hint: "Photos of family and friends the family may want to recognise.", privateOnly: false },
  { id: "prescriptions", title: "Prescriptions", hint: "Doctor's prescriptions, copied exactly as written.", privateOnly: true },
  { id: "medical_reports", title: "Medical reports", hint: "Lab results, discharge summaries, scans.", privateOnly: true },
  { id: "medical_bills", title: "Medical bills", hint: "Bills and receipts from clinics, pharmacies, and hospitals.", privateOnly: true },
  { id: "medicine_photos", title: "Medicine strips", hint: "A photo of each strip or bottle, so the family can check the name.", privateOnly: true },
  { id: "identity_proofs", title: "Identity proofs", hint: "Aadhaar, PAN, voter ID, or any ID that identifies the parent.", privateOnly: true },
  { id: "insurance", title: "Insurance and benefits", hint: "Health insurance cards, policies, pension papers.", privateOnly: true },
  { id: "other", title: "Other", hint: "Anything else the family wants to keep.", privateOnly: false },
];

const LINK_REFRESH_MS = 25 * 60 * 1000;

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The profile photo of the parent. Its link expires after 30 minutes, so a fresh one is fetched every 25.
export function useProfilePhoto(householdId: string, enabled: boolean, version = 0): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !householdId) {
      setUrl(null);
      return;
    }
    let live = true;
    const load = () =>
      listFiles(householdId)
        .then((files) => files.find((f) => f.category === "profile_photo"))
        .then((photo) => (photo ? fileLink(householdId, photo.id).then((l) => l.url) : null))
        .then((next) => {
          if (live) setUrl(next);
        })
        .catch(() => {
          if (live) setUrl(null);
        });
    void load();
    const id = window.setInterval(() => void load(), LINK_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [householdId, enabled, version]);
  return url;
}

// A small preview of an image file. Private files use a link that expires, so it is renewed before then.
function Thumb({ householdId, file }: { householdId: string; file: StoredFile }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!file.contentType.startsWith("image/")) return;
    let live = true;
    const load = () =>
      fileLink(householdId, file.id)
        .then((l) => live && setSrc(l.url))
        .catch(() => live && setSrc(""));
    void load();
    const id = window.setInterval(() => void load(), LINK_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [householdId, file.id, file.contentType]);
  if (!file.contentType.startsWith("image/")) {
    return (
      <span className="doc-thumb doc-thumb-pdf" aria-hidden="true">
        PDF
      </span>
    );
  }
  return src ? <img className="doc-thumb" src={src} alt="" /> : <span className="doc-thumb" aria-hidden="true" />;
}

type SectionProps = {
  category: FileCategory;
  files: StoredFile[];
  householdId: string;
  who: string;
  onUploaded: () => Promise<void>;
};

// One category: its own upload form and its own list, so each kind of record is added and found in one place.
function CategorySection({ category, files, householdId, who, onUploaded }: SectionProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [shared, setShared] = useState(false);
  const single = category.id === "profile_photo";
  const images = single || category.id === "family_photos";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = input.current?.files?.[0];
    if (!file) {
      setFailed(true);
      setNote("Choose a file first.");
      return;
    }
    const label = String(new FormData(form).get("label") ?? "").trim();
    setBusy(true);
    setNote("");
    try {
      await uploadFile(householdId, file, category.id, label, shared && !category.privateOnly ? "public" : "private");
      await onUploaded();
      setFailed(false);
      setNote(single ? "Photo saved." : "Saved.");
      form.reset();
      setShared(false);
    } catch (err) {
      setFailed(true);
      setNote(err instanceof Error ? err.message : "The upload did not finish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function open(file: StoredFile) {
    try {
      const link = await fileLink(householdId, file.id);
      window.open(link.url, "_blank", "noopener");
    } catch {
      setFailed(true);
      setNote("Could not open that file. Try again.");
    }
  }

  async function remove(file: StoredFile) {
    if (!window.confirm(`Delete ${file.label || file.name}? This cannot be undone.`)) return;
    try {
      await deleteFile(householdId, file.id);
      await onUploaded();
      setFailed(false);
      setNote("Deleted.");
    } catch {
      setFailed(true);
      setNote("Could not delete that file. Try again.");
    }
  }

  const headingId = `doc-${category.id}`;
  return (
    <section className="doc-cat" aria-labelledby={headingId}>
      <header>
        <h3 id={headingId}>{category.title}</h3>
        <span className="doc-count">{files.length === 0 ? "None yet" : `${files.length} saved`}</span>
      </header>
      <p className="doc-hint">{category.hint}</p>

      <form className="doc-form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          {single ? "Photo" : "File"}
          <input
            ref={input}
            type="file"
            accept={images ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"}
            disabled={busy}
          />
        </label>
        {single ? null : (
          <label className="field">
            Label <span className="optional">(optional)</span>
            <input name="label" maxLength={80} placeholder={`e.g. ${category.title}, ${new Date().getFullYear()}`} />
          </label>
        )}
        {category.privateOnly ? (
          <p className="doc-private">Always private. Only {who}&rsquo;s household can open it.</p>
        ) : (
          <label className="check">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} disabled={busy} />
            Anyone with the link can see this (otherwise it stays private)
          </label>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Uploading…" : single && files.length > 0 ? "Replace photo" : "Upload"}
        </button>
      </form>

      {note ? (
        <p className={failed ? "field-error" : "note"} role={failed ? "alert" : "status"}>
          {note}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul className="doc-list">
          {files.map((f) => (
            <li key={f.id}>
              <Thumb householdId={householdId} file={f} />
              <div className="doc-meta">
                <strong>{f.label || f.name}</strong>
                <span>
                  {f.visibility === "public" ? "Shared by link" : "Private"} · {sizeLabel(f.size)} ·{" "}
                  {new Date(f.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              <div className="doc-actions">
                <button className="ghost" type="button" onClick={() => void open(f)}>
                  Open
                </button>
                <button className="ghost" type="button" onClick={() => void remove(f)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// Photos and documents the family keeps so that a responder, or Saathi's family, can tell who this person is.
// Each category has its own form. Files are stored in a locked bucket; a private file opens through a link that
// stops working after 30 minutes.
export function DocumentsCard({ householdId, name, demo, onChanged }: Props) {
  const who = name || "your parent";
  const [categories, setCategories] = useState<FileCategory[]>(FALLBACK_CATEGORIES);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loadError, setLoadError] = useState("");

  // The parent passes a new callback on every render, so keep the latest in a ref instead of a dependency.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const refresh = useCallback(async () => {
    try {
      setFiles(await listFiles(householdId));
      setLoadError("");
    } catch {
      setLoadError("Could not load saved files. Check the connection.");
    }
  }, [householdId]);

  useEffect(() => {
    if (demo || !householdId) return;
    void refresh();
    fetchCategories()
      .then(setCategories)
      .catch(() => {
        // Keep the built-in list.
      });
  }, [householdId, demo, refresh]);

  return (
    <section className="panel-wide documents" aria-labelledby="documents-title">
      <h2 id="documents-title">Photos and documents</h2>
      <p>
        Keep what identifies {who} and what the family needs to find quickly. Pick a category, choose a file (JPEG, PNG,
        WebP, or a PDF up to 8&nbsp;MB), and upload. Private files open through a link that stops working after 30
        minutes.
      </p>
      {demo ? (
        <p className="note">Uploads are turned off in the demo household. Create an account to try them.</p>
      ) : (
        <>
          {loadError ? (
            <p className="field-error" role="alert">
              {loadError}{" "}
              <button className="text-link" type="button" onClick={() => void refresh()}>
                Try again
              </button>
            </p>
          ) : null}
          <div className="doc-grid">
            {categories.map((c) => (
              <CategorySection
                key={c.id}
                category={c}
                files={files.filter((f) => f.category === (c.id as FileCategoryId))}
                householdId={householdId}
                who={who}
                onUploaded={async () => {
                  await refresh();
                  changed.current?.();
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
