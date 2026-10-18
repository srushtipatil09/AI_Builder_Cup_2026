import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { deleteFile, readSampleNote, readStoredNote, uploadFile, type FileCategory, type StoredFile } from "../../lib/api";
import { useAppDispatch, useAppSelector } from "../../store";
import { fileLinksForget, linkUsable, loadCategories, loadFileLink, loadFiles } from "../../store/reads";
import { useToast } from "../../toast";
import { newId, type Desk, type Medicine } from "../../desk";
import { analyzeDoctorReportWithMedGemma, mapAnalysisToDeskRecords, type MedGemmaReportAnalysis } from "../../lib/medGemma";
import { suggestReminders, type SuggestedReminder } from "../../lib/remindersFromPage";
import { languageFor } from "../../lib/languages";

type Props = {
  householdId: string;
  name: string;
  demo: boolean;
  onChanged?: () => void;
  desk?: Desk;
  setDesk?: (d: Desk) => void;
  author?: string;
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

function GeminiMark() {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="gemini-mark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1a73e8" />
          <stop offset="0.55" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M12 1.6 14.2 9 21.6 12 14.2 15 12 22.4 9.8 15 2.4 12 9.8 9 12 1.6z" />
    </svg>
  );
}

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

// A real link, so the browser opens the file on the API host. A button that waits, then calls window.open, is blocked.
function OpenFile({ householdId, fileId }: { householdId: string; fileId: string }) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const url = useFileLink(householdId, fileId);
  if (url) {
    return (
      <a className="ghost" href={url} target="_blank" rel="noopener noreferrer">
        Open
      </a>
    );
  }
  return (
    <button
      className="ghost"
      type="button"
      onClick={() => {
        const tab = window.open("about:blank", "_blank");
        void dispatch(loadFileLink({ householdId, fileId }))
          .unwrap()
          .then((link) => {
            if (tab) tab.location.replace(link.url);
          })
          .catch(() => {
            tab?.close();
            toast("Could not open that file. Try again.", "bad");
          });
      }}
    >
      Open
    </button>
  );
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
  const toast = useToast();
  const [categoryId, setCategoryId] = useState<string>(categories.find((c) => c.id === "prescriptions")?.id ?? categories[0].id);
  const [chosen, setChosen] = useState<File[]>([]);
  const [label, setLabel] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const category = categories.find((c) => c.id === categoryId) ?? categories[0];
  const single = category.id === "profile_photo";
  const imagesOnly = single || category.id === "family_photos";

  function pick(list: FileList | File[] | null) {
    const all = Array.from(list ?? []);
    const files = all.filter((f) => (imagesOnly ? IMAGE_TYPES : ALL_TYPES).split(",").includes(f.type));
    setChosen(single ? files.slice(0, 1) : files);
    if (files.length < all.length) {
      toast(imagesOnly ? "Only JPEG, PNG or WebP images are accepted here." : "Only JPEG, PNG, WebP or PDF files are accepted.", "bad");
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) pick(event.dataTransfer.files);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen.length) {
      toast("Choose a file first.", "bad");
      return;
    }
    setBusy(true);
    let saved = 0;
    try {
      for (const file of chosen) {
        // A label names one file; several files keep their own names.
        await uploadFile(householdId, file, category.id, chosen.length === 1 ? label.trim() : "", shared && !category.privateOnly ? "public" : "private");
        saved += 1;
      }
      await onUploaded();
      toast(single ? "Photo saved." : saved === 1 ? "Saved." : `${saved} files saved.`, "ok");
      setChosen([]);
      setLabel("");
      setShared(false);
      if (input.current) input.current.value = "";
    } catch (err) {
      if (saved) await onUploaded();
      toast(`${saved ? `${saved} saved, then it stopped. ` : ""}${err instanceof Error ? err.message : "The upload did not finish. Try again."}`, "bad");
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
    </form>
  );
}

type LibraryProps = {
  categories: FileCategory[];
  files: StoredFile[];
  householdId: string;
  demo: boolean;
  onChanged: () => Promise<void>;
  desk?: Desk;
  setDesk?: (d: Desk) => void;
  author?: string;
};

// Everything saved so far, in one list. A filter row narrows it to one kind of record.
function Library({ categories, files, householdId, demo, onChanged, desk, setDesk, author }: LibraryProps) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<MedGemmaReportAnalysis | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedReminder[]>([]);
  const closeRead = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSuggestions(analysis ? suggestReminders(analysis.prescribedRoutines) : []);
  }, [analysis]);

  useEffect(() => {
    if (!analysis) return;
    closeRead.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnalysis(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analysis]);

  const readable = (file: StoredFile) =>
    (file.category === "prescriptions" || file.category === "medical_reports") &&
    (file.contentType.startsWith("image/") || file.contentType === "application/pdf");

  async function readSample() {
    setAnalyzing(true);
    try {
      const res = await readSampleNote();
      setAnalysis({ ...res, source: res.source ?? "page" });
      toast(
        res.source === "unreadable" ? "This page could not be read. Nothing was added." : "Read from the sample page. Confirm if you want it on the desk.",
        res.source === "unreadable" ? "info" : "ok",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "This page could not be read. You can still open the prepared preview.", "bad");
    } finally {
      setAnalyzing(false);
    }
  }

  async function readPage(file: StoredFile) {
    setAnalyzing(true);
    try {
      const res = await readStoredNote(householdId, file.id);
      setAnalysis(res);
      toast(
        res.source === "page" ? "Read from this page. Confirm if you want it on the desk." : "This page could not be read. Nothing was added.",
        res.source === "page" ? "ok" : "info",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "This page could not be read. You can still open the prepared preview.", "bad");
    } finally {
      setAnalyzing(false);
    }
  }

  async function runMedGemma(docName: string) {
    setAnalyzing(true);
    try {
      const res = await analyzeDoctorReportWithMedGemma(docName, "prescriptions", author || "Caretaker");
      setAnalysis(res);
      toast("Preview ready. Confirm if you want it on the desk.", "ok");
    } catch {
      toast("The preview did not open. Try again.", "bad");
    } finally {
      setAnalyzing(false);
    }
  }

  function applyMedGemmaToDesk() {
    if (analysis?.source === "unreadable") {
      toast("Nothing was added.", "info");
      setAnalysis(null);
      return;
    }
    if (!analysis || !desk || !setDesk) {
      toast("Preview is ready. Confirm to keep it on the desk.", "info");
      setAnalysis(null);
      return;
    }
    const { newMemories } = mapAnalysisToDeskRecords(analysis, author || "Caretaker");
    const have = new Set(desk.medicines.map((m) => `${m.name.toLowerCase()}|${m.time}`));
    const toAdd: Medicine[] = suggestions
      .filter((s) => s.on && s.time && !have.has(`${s.name.toLowerCase()}|${s.time}`))
      .map((s) => ({
        id: newId(),
        kind: s.kind,
        name: s.name,
        dose: s.dose,
        schedule: s.schedule,
        date: s.schedule === "Once" ? s.date : "",
        time: s.time,
        note: s.note,
      }));

    setDesk({
      ...desk,
      medicines: [...desk.medicines, ...toAdd],
      memories: [...desk.memories, ...newMemories],
    });

    toast(
      toAdd.length
        ? `Added ${toAdd.length} reminder${toAdd.length === 1 ? "" : "s"} and ${newMemories.length} note${newMemories.length === 1 ? "" : "s"}.`
        : "No new reminders. The notes were kept.",
      "ok",
    );
    setAnalysis(null);
  }

  const titles = Object.fromEntries(categories.map((c) => [c.id, c.title]));
  const counts = categories.map((c) => ({ c, n: files.filter((f) => f.category === c.id).length })).filter((x) => x.n > 0);
  const active = filter !== "all" && !counts.some((x) => x.c.id === filter) ? "all" : filter;
  const shown = active === "all" ? files : files.filter((f) => f.category === active);

  async function remove(file: StoredFile) {
    if (!window.confirm(`Delete ${file.label || file.name}? This cannot be undone.`)) return;
    try {
      await deleteFile(householdId, file.id);
      dispatch(fileLinksForget([file.id]));
      await onChanged();
      toast("Deleted.", "ok");
    } catch {
      toast("Could not delete that file. Try again.", "bad");
    }
  }

  return (
    <div className="doc-library">
      <div className="doc-library-head">
        <h3>Saved files</h3>
        <span className={files.length === 0 ? "doc-count" : "doc-count doc-count-on"}>{files.length === 0 ? "None yet" : `${files.length} saved`}</span>
      </div>

      <div className="medgemma-preview">
        <div>
          <h4 className="doc-step-title">A note, in a few lines</h4>
          <p>
            On a saved prescription or report, Read this page copies what is printed, once, with Gemini Flash. Confirm before it is kept. Open preview shows a prepared note when you do not have a page. A MedGemma machine stays billed while it is on, so that machine is not running.
          </p>
        </div>
        <div className="medgemma-actions">
          {demo ? (
            <button type="button" className="primary" onClick={() => void readSample()} disabled={analyzing}>
              <GeminiMark />
              {analyzing ? "Reading…" : "Read the sample page"}
            </button>
          ) : null}
          <button
            type="button"
            className="ghost"
            onClick={() => void runMedGemma("Dr. Mehta Prescription - Cardiology")}
            disabled={analyzing}
          >
            {analyzing ? "Preparing…" : "Open preview"}
          </button>
        </div>
      </div>

      {analysis ? (
        <div className="read-sheet" role="presentation" onClick={(event) => event.target === event.currentTarget && setAnalysis(null)}>
        <article
          className="medgemma-result"
          role="dialog"
          aria-modal="true"
          aria-labelledby="read-title"
        >
          <header className="read-head">
            <div className="read-head-text">
              <p className={`read-kicker read-kicker-${analysis.source ?? "page"}`}>
                {analysis.source === "page" ? "From this page" : analysis.source === "unreadable" ? "Could not read" : "Prepared note"}
              </p>
              <h4 id="read-title">{analysis.reportTitle}</h4>
              {analysis.doctorName ? <p className="read-doctor">{analysis.doctorName}</p> : null}
            </div>
            <button ref={closeRead} className="read-close" type="button" aria-label="Close" onClick={() => setAnalysis(null)}>
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div className="read-body">
            <section className="read-summary" aria-labelledby="read-family">
              <h5 id="read-family">For the family</h5>
              <p>{analysis.plainSummary}</p>
              {analysis.localSummary && analysis.localLanguage ? (
                <div className="read-local">
                  <span className="read-lang">{languageFor(analysis.localLanguage).native}</span>
                  <p lang={languageFor(analysis.localLanguage).code}>{analysis.localSummary}</p>
                </div>
              ) : null}
            </section>

            {suggestions.length > 0 ? (
            <fieldset className="suggested-reminders">
              <legend>Suggested reminders</legend>
              <p className="suggested-intro">Tick the ones to add. A clock time that was not printed on the page is only a suggestion.</p>
              <ul>
                {suggestions.map((item) => (
                  <li key={item.id} className={item.on ? "suggested-row suggested-row-on" : "suggested-row"}>
                    <label className="suggested-pick">
                      <input
                        type="checkbox"
                        checked={item.on}
                        onChange={(event) =>
                          setSuggestions((rows) => rows.map((row) => (row.id === item.id ? { ...row, on: event.target.checked } : row)))
                        }
                      />
                      <span className="suggested-text">
                        <strong>{item.name}</strong>
                        <span className="suggested-when">{item.schedule === "Daily" ? "Every day" : `Once, ${item.date}`}</span>
                      </span>
                    </label>
                    <label className="suggested-time">
                      <span className="visually-hidden">Time for {item.name}</span>
                      <input
                        type="time"
                        value={item.time}
                        disabled={!item.on}
                        onChange={(event) =>
                          setSuggestions((rows) => rows.map((row) => (row.id === item.id ? { ...row, time: event.target.value } : row)))
                        }
                      />
                    </label>
                    <p className="suggested-hint">
                      {item.hint}
                      {item.note ? <span className="suggested-note"> Page says: “{item.note}”</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            </fieldset>
            ) : null}

            <p className="read-disclaimer">{analysis.disclaimer}</p>
          </div>

          <footer className="read-foot">
            <button type="button" className="ghost" onClick={() => setAnalysis(null)}>
              Dismiss
            </button>
            {analysis.source === "unreadable" ? null : (
            <button type="button" className="primary" onClick={applyMedGemmaToDesk}>
              {(() => {
                const n = suggestions.filter((item) => item.on).length;
                return n ? `Add ${n} reminder${n === 1 ? "" : "s"}` : "Confirm and add to the desk";
              })()}
            </button>
            )}
          </footer>
        </article>
        </div>
      ) : null}

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
                  {readable(f) ? (
                    <button className="ghost" type="button" onClick={() => void readPage(f)} disabled={analyzing}>
                      <GeminiMark />
                      {analyzing ? "Reading…" : "Read this page"}
                    </button>
                  ) : null}
                  <OpenFile householdId={householdId} fileId={f.id} />
                  <button className="ghost" type="button" onClick={() => void remove(f)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Photos and documents the family keeps so that a responder, or Saathi's family, can tell who this person is.
// Files are stored in a locked bucket; a private file opens through a link that stops working after 30 minutes.
export function DocumentsCard({ householdId, name, demo, onChanged, desk, setDesk, author }: Props) {
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
        <Library
          categories={categories}
          files={files}
          householdId={householdId}
          demo={demo}
          onChanged={afterChange}
          desk={desk}
          setDesk={setDesk}
          author={author}
        />
      </div>
    </section>
  );
}
