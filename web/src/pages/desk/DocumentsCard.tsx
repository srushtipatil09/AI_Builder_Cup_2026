import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { deleteFile, uploadFile, type FileCategory, type StoredFile } from "../../lib/api";
import { useAppDispatch, useAppSelector } from "../../store";
import { fileLinksForget, fileUrl, linkUsable, loadCategories, loadFileLink, loadFiles } from "../../store/reads";

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
const NO_FILES: StoredFile[] = [];

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// A file's link from the store. Private links stop working after 30 minutes; the store renews one 5 minutes
// before that, so the timer here only asks it to check.
function useFileLink(householdId: string, fileId: string | undefined): string | null {
  const dispatch = useAppDispatch();
  const hit = useAppSelector((state) => (fileId ? state.reads.links[fileId] : undefined));
  useEffect(() => {
    if (!householdId || !fileId) return;
    const load = () => void dispatch(loadFileLink({ householdId, fileId }));
    load();
    const id = window.setInterval(load, LINK_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [dispatch, householdId, fileId]);
  return hit && linkUsable(hit) ? hit.url : null;
}

// The newest profile photo, found in the household's file list. The documents card reads the same list again after
// an upload or delete, so this hook sees the new photo without a read of its own.
export function useProfilePhoto(householdId: string, enabled: boolean): string | null {
  const dispatch = useAppDispatch();
  const files = useAppSelector((state) => state.reads.files[householdId]?.value);
  useEffect(() => {
    if (enabled && householdId) void dispatch(loadFiles({ householdId }));
  }, [dispatch, householdId, enabled]);
  const photo = enabled
    ? (files ?? []).filter((f) => f.category === "profile_photo").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  return useFileLink(householdId, photo?.id);
}

// A small preview of an image file. Private files use a link that expires, so it is renewed before then.
function Thumb({ householdId, file }: { householdId: string; file: StoredFile }) {
  const src = useFileLink(householdId, file.contentType.startsWith("image/") ? file.id : undefined) ?? "";
  if (!file.contentType.startsWith("image/")) {
    return (
      <span className="doc-thumb doc-thumb-pdf" aria-hidden="true">
        PDF
      </span>
    );
  }
  return src ? <img className="doc-thumb" src={src} alt="" /> : <span className="doc-thumb" aria-hidden="true" />;
}

const IMAGE_TYPES = "image/jpeg,image/png,image/webp";
const ALL_TYPES = `${IMAGE_TYPES},application/pdf`;

type UploaderProps = {
  categories: FileCategory[];
  householdId: string;
  who: string;
  hasProfilePhoto: boolean;
  onUploaded: () => Promise<void>;
};

// One form for every kind of record: pick what it is, pick the file(s), upload. Each category used to repeat the same form.
function Uploader({ categories, householdId, who, hasProfilePhoto, onUploaded }: UploaderProps) {
  const input = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState<string>(categories.find((c) => c.id === "prescriptions")?.id ?? categories[0].id);
  const [chosen, setChosen] = useState<File[]>([]);
  const [label, setLabel] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);

  const category = categories.find((c) => c.id === categoryId) ?? categories[0];
  const single = category.id === "profile_photo";
  const imagesOnly = single || category.id === "family_photos";

  function pick(list: FileList | File[] | null) {
    const all = Array.from(list ?? []);
    const files = all.filter((f) => (imagesOnly ? IMAGE_TYPES : ALL_TYPES).split(",").includes(f.type));
    setChosen(single ? files.slice(0, 1) : files);
    setFailed(files.length < all.length);
    setNote(
      files.length < all.length
        ? imagesOnly
          ? "Only JPEG, PNG or WebP images are accepted here."
          : "Only JPEG, PNG, WebP or PDF files are accepted."
        : "",
    );
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) pick(event.dataTransfer.files);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen.length) {
      setFailed(true);
      setNote("Choose a file first.");
      return;
    }
    setBusy(true);
    setNote("");
    let saved = 0;
    try {
      for (const file of chosen) {
        // A label names one file; several files keep their own names.
        await uploadFile(householdId, file, category.id, chosen.length === 1 ? label.trim() : "", shared && !category.privateOnly ? "public" : "private");
        saved += 1;
      }
      await onUploaded();
      setFailed(false);
      setNote(single ? "Photo saved." : saved === 1 ? "Saved." : `${saved} files saved.`);
      setChosen([]);
      setLabel("");
      setShared(false);
      if (input.current) input.current.value = "";
    } catch (err) {
      if (saved) await onUploaded();
      setFailed(true);
      setNote(`${saved ? `${saved} saved, then it stopped. ` : ""}${err instanceof Error ? err.message : "The upload did not finish. Try again."}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="doc-upload" onSubmit={(e) => void submit(e)} aria-label="Add a photo or document">
      <div className="doc-step">
        <span className="doc-step-n" aria-hidden="true">1</span>
        <div className="doc-step-body">
          <p className="doc-step-title" id="doc-what">What is it?</p>
          <div className="doc-chips" role="radiogroup" aria-labelledby="doc-what">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={c.id === category.id}
                className={c.id === category.id ? "doc-chip doc-chip-on" : "doc-chip"}
                onClick={() => {
                  setCategoryId(c.id);
                  setChosen([]);
                  setNote("");
                  if (input.current) input.current.value = "";
                }}
              >
                {c.title}
              </button>
            ))}
          </div>
          <p className="doc-hint">{category.hint}</p>
        </div>
      </div>

      <div className="doc-step">
        <span className="doc-step-n" aria-hidden="true">2</span>
        <div className="doc-step-body">
          <p className="doc-step-title" id="doc-file">{single ? "Choose the photo" : "Choose the file"}</p>
          <label
            className={`doc-drop${chosen.length ? " doc-drop-on" : ""}${dragging ? " doc-drop-drag" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={input}
              className="visually-hidden"
              type="file"
              multiple={!single}
              aria-labelledby="doc-file"
              accept={imagesOnly ? IMAGE_TYPES : ALL_TYPES}
              disabled={busy}
              onChange={(e) => pick(e.target.files)}
            />
            <span className="doc-picker-button" aria-hidden="true">{chosen.length ? "Change" : "Choose file"}</span>
            <span className="doc-picker-name">
              {chosen.length
                ? chosen.length === 1
                  ? `${chosen[0].name} · ${sizeLabel(chosen[0].size)}`
                  : `${chosen.length} files selected`
                : `or drop here · ${imagesOnly ? "JPEG, PNG, WebP" : "JPEG, PNG, WebP, PDF"} up to 8 MB`}
            </span>
          </label>
          {single ? null : (
            <label className="doc-label">
              <span>
                Label <span className="optional">(optional)</span>
              </span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
                disabled={chosen.length > 1}
                placeholder={chosen.length > 1 ? "Each file keeps its own name" : `e.g. ${category.title}, ${new Date().getFullYear()}`}
              />
            </label>
          )}
        </div>
      </div>

      <div className="doc-step">
        <span className="doc-step-n" aria-hidden="true">3</span>
        <div className="doc-step-body doc-step-row">
          {category.privateOnly ? (
            <p className="doc-private">
              <span className="doc-lock" aria-hidden="true" />
              Always private. Only {who}&rsquo;s household can open it.
            </p>
          ) : (
            <label className="doc-share">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} disabled={busy} />
              <span>
                Share with anyone who has the link
                <small>Leave unticked to keep it private.</small>
              </span>
            </label>
          )}
          <button className="primary doc-submit" type="submit" disabled={busy || !chosen.length}>
            {busy ? "Uploading…" : single && hasProfilePhoto ? "Replace photo" : "Upload"}
          </button>
        </div>
      </div>

      {note ? (
        <p className={failed ? "field-error" : "note"} role={failed ? "alert" : "status"}>
          {note}
        </p>
      ) : null}
    </form>
  );
}

type LibraryProps = {
  categories: FileCategory[];
  files: StoredFile[];
  householdId: string;
  onChanged: () => Promise<void>;
};

// Everything saved so far, in one list. A filter row narrows it to one kind of record.
function Library({ categories, files, householdId, onChanged }: LibraryProps) {
  const dispatch = useAppDispatch();
  const [filter, setFilter] = useState("all");
  const [note, setNote] = useState("");
  const titles = Object.fromEntries(categories.map((c) => [c.id, c.title]));
  const counts = categories.map((c) => ({ c, n: files.filter((f) => f.category === c.id).length })).filter((x) => x.n > 0);
  const active = filter !== "all" && !counts.some((x) => x.c.id === filter) ? "all" : filter;
  const shown = active === "all" ? files : files.filter((f) => f.category === active);

  async function open(file: StoredFile) {
    try {
      const url = await dispatch(fileUrl(householdId, file.id));
      window.open(url, "_blank", "noopener");
    } catch {
      setNote("Could not open that file. Try again.");
    }
  }

  async function remove(file: StoredFile) {
    if (!window.confirm(`Delete ${file.label || file.name}? This cannot be undone.`)) return;
    try {
      await deleteFile(householdId, file.id);
      dispatch(fileLinksForget([file.id]));
      await onChanged();
      setNote("Deleted.");
    } catch {
      setNote("Could not delete that file. Try again.");
    }
  }

  return (
    <div className="doc-library">
      <div className="doc-library-head">
        <h3>Saved files</h3>
        <span className={files.length === 0 ? "doc-count" : "doc-count doc-count-on"}>{files.length === 0 ? "None yet" : `${files.length} saved`}</span>
      </div>
      {files.length === 0 ? (
        <p className="doc-empty">Nothing saved yet. Pick what it is, choose a file, and upload. It will appear here.</p>
      ) : (
        <>
          <div className="doc-chips" role="group" aria-label="Filter saved files">
            <button type="button" aria-pressed={active === "all"} className={active === "all" ? "doc-chip doc-chip-on" : "doc-chip"} onClick={() => setFilter("all")}>
              All {files.length}
            </button>
            {counts.map(({ c, n }) => (
              <button key={c.id} type="button" aria-pressed={active === c.id} className={active === c.id ? "doc-chip doc-chip-on" : "doc-chip"} onClick={() => setFilter(c.id)}>
                {c.title} {n}
              </button>
            ))}
          </div>
          <ul className="doc-list">
            {shown.map((f) => (
              <li key={f.id}>
                <Thumb householdId={householdId} file={f} />
                <div className="doc-meta">
                  <strong>{f.label || f.name}</strong>
                  <span>
                    {titles[f.category] ?? f.category} · {f.visibility === "public" ? "Shared by link" : "Private"} · {sizeLabel(f.size)} ·{" "}
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
        </>
      )}
      {note ? (
        <p className="note" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}

// Photos and documents the family keeps so that a responder, or Saathi's family, can tell who this person is.
// Files are stored in a locked bucket; a private file opens through a link that stops working after 30 minutes.
export function DocumentsCard({ householdId, name, demo, onChanged }: Props) {
  const who = name || "your parent";
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.reads.categories?.value) ?? FALLBACK_CATEGORIES;
  const files = useAppSelector((state) => state.reads.files[householdId]?.value) ?? NO_FILES;
  const [loadError, setLoadError] = useState("");

  // The parent passes a new callback on every render, so keep the latest in a ref instead of a dependency.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  // force: after an upload or delete, and from "Try again". Otherwise a recent copy is used as it is.
  const refresh = useCallback(
    async (force = true) => {
      try {
        await dispatch(loadFiles({ householdId, force })).unwrap();
        setLoadError("");
      } catch (err) {
        if ((err as { name?: string })?.name !== "ConditionError") setLoadError("Could not load saved files. Check the connection.");
      }
    },
    [dispatch, householdId],
  );

  useEffect(() => {
    if (!householdId) return;
    void refresh(false);
    // The categories rarely change; the built-in list stays until the server's arrives.
    void dispatch(loadCategories());
  }, [dispatch, householdId, refresh]);

  const afterChange = async () => {
    await refresh();
    changed.current?.();
  };

  return (
    <section className="panel-wide documents" aria-labelledby="documents-title">
      <h2 id="documents-title">Photos and documents</h2>
      <p>
        Keep what identifies {who} and what the family needs to find quickly. Private files open through a link that
        stops working after 30 minutes.
      </p>
      {demo ? (
        <p className="note">
          This is the shared demo account. Uploads work and are saved, but everyone trying the demo can see them. Please
          use sample files, not real personal documents.
        </p>
      ) : null}
      {loadError ? (
        <p className="field-error" role="alert">
          {loadError}{" "}
          <button className="text-link" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      ) : null}
      <div className="doc-layout">
        <Uploader
          categories={categories}
          householdId={householdId}
          who={who}
          hasProfilePhoto={files.some((f) => f.category === "profile_photo")}
          onUploaded={afterChange}
        />
        <Library categories={categories} files={files} householdId={householdId} onChanged={afterChange} />
      </div>
    </section>
  );
}
