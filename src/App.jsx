import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getPref, setPref } from "./db/db.js";
import { createNote, liveNotes, purgeExpired, trashNote, updateNote } from "./db/notes.js";
import { buildBackup, backupFilename, importBackup, validateBackup } from "./db/backup.js";
import { downloadJson, readFileAsText } from "./lib/file.js";
import { nowIso } from "./lib/dates.js";
import { firstLine } from "./lib/text.js";
import { SaveQueue } from "./lib/saveQueue.js";
import { APP_VERSION, SCHEMA_VERSION } from "./version.js";
import NoteEditor from "./editor/NoteEditor.jsx";
import { DEFAULT_TOOLBAR } from "./editor/actions.js";

export default function App() {
  const [queue] = useState(() => new SaveQueue({ save: updateNote }));
  const status = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const [view, setView] = useState("list");
  const [notes, setNotes] = useState([]);
  const [note, setNote] = useState(null);
  const [toolbar, setToolbar] = useState(DEFAULT_TOOLBAR);
  const [persisted, setPersisted] = useState(undefined);
  const [lastBackupAt, setLastBackupAt] = useState(undefined);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const operation = useRef(false);

  async function refresh() {
    const [rows, savedToolbar, savedPersistence, backupAt] = await Promise.all([
      liveNotes(), getPref("toolbar"), getPref("storagePersisted"), getPref("lastBackupAt"),
    ]);
    setNotes(rows);
    setToolbar(Array.isArray(savedToolbar) ? savedToolbar : DEFAULT_TOOLBAR);
    // A backup's persistence flag is from its source device. Prefer this browser's answer.
    const actualPersistence = await navigator.storage?.persisted?.().catch(() => undefined);
    setPersisted(navigator.storage?.persist ? actualPersistence ?? savedPersistence : "unavailable");
    setLastBackupAt(backupAt);
  }

  useEffect(() => {
    let mounted = true;
    purgeExpired().then(() => { if (mounted) return refresh(); }).catch((error) => {
      if (mounted) setError(error.message);
    }).finally(() => { if (mounted) setBusy(false); });
    const flush = () => { queue.flush().catch(() => {}); }; // The queue retains and displays failures.
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [queue]);

  async function run(task) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try { await task(); }
    catch (error) { setError(error.message || "The operation failed. Please try again."); }
    finally { operation.current = false; setBusy(false); }
  }

  async function leave(next) {
    await queue.flush();
    await refresh();
    setView(next);
    setNote(null);
  }

  function edit(patch) {
    queue.schedule(note.id, patch);
    setNote((current) => ({ ...current, ...patch }));
  }

  async function newNote() {
    await queue.flush();
    const created = await createNote();
    setNote(created);
    setView("note");
    if (await getPref("storagePersisted") === undefined) {
      let granted = false;
      try { granted = await navigator.storage?.persist?.() ?? false; }
      catch { /* Unsupported or denied: the note is still saved. */ }
      await setPref("storagePersisted", granted);
      setPersisted(navigator.storage?.persist ? granted : "unavailable");
    }
  }

  async function exportFile() {
    await queue.flush();
    const backup = await buildBackup();
    downloadJson(backup, backupFilename());
    const at = nowIso();
    await setPref("lastBackupAt", at);
    setLastBackupAt(at);
    setMessage("Backup download started.");
  }

  async function replaceFromPreview() {
    if (!preview?.result.ok) return;
    await queue.flush();
    const before = await buildBackup();
    const after = preview.result.envelope;
    if (!window.confirm(`Replace ${before.notes.length} notes and ${before.folders.length} folders with ${after.notes.length} notes and ${after.folders.length} folders?`)) return;
    downloadJson(before, `before-import-${backupFilename()}`);
    await importBackup(after);
    setPreview(null);
    await refresh();
    setMessage("Backup imported. Your previous notebook's safety download was started first.");
  }

  return <main className="mx-auto flex min-h-full max-w-2xl flex-col">
    <header className="flex items-center justify-between gap-3 px-4 py-3">
      <h1 className="font-semibold">{view === "settings" ? "Settings" : "Notes"}</h1>
      <div className="flex items-center gap-4">
        {view === "note" && <span role="status" className={`text-xs ${status === "error" ? "font-semibold text-red-700" : "text-gray-500"}`}>{status === "error" ? "Not saved" : status}</span>}
        {view === "list" ? <button disabled={busy} onClick={() => run(() => leave("settings"))}>Settings</button> :
          <button disabled={busy} onClick={() => run(() => leave("list"))}>Back</button>}
      </div>
    </header>
    {error && <p role="alert" className="mx-4 mb-3 text-sm text-red-700">{error}</p>}
    {status === "error" && <div role="alert" className="mx-4 mb-3 text-sm text-red-700">
      <p>Not saved. {queue.error?.message}</p>
      <button className="underline" disabled={busy} onClick={() => run(() => queue.flush())}>Retry save</button>
    </div>}
    {message && <p role="status" className="mx-4 mb-3 text-sm">{message}</p>}

    {view === "list" && <section className="px-4">
      <button className="app-button mb-4" disabled={busy} onClick={() => run(newNote)}>+ New note</button>
      {!busy && !notes.length && <p className="text-gray-500">No notes yet.</p>}
      <ul className="divide-y divide-gray-200">
        {notes.map((row) => <li key={row.id}>
          <button className="w-full py-4 text-left" disabled={busy} onClick={() => { setNote(row); setView("note"); setMessage(""); }}>
            <span className="block truncate">{row.title.trim() || firstLine(row.text) || "Untitled note"}</span>
          </button>
        </li>)}
      </ul>
    </section>}

    {view === "note" && note && <section className="flex flex-1 flex-col" inert={busy} onBlur={() => { queue.flush().catch(() => {}); }}>
      <div className="flex items-center gap-3 px-4">
        <input className="min-w-0 flex-1 bg-transparent py-2 text-xl font-semibold outline-none" aria-label="Title" placeholder="Title (optional)"
          value={note.title} onChange={(event) => edit({ title: event.target.value })} />
        <button className="text-sm text-red-700" disabled={busy} onClick={() => run(async () => {
          if (!window.confirm("Move this note to Trash?")) return;
          await queue.flush();
          await trashNote(note.id);
          await leave("list");
        })}>Delete</button>
      </div>
      <NoteEditor note={note} onChange={(html) => edit({ html })} toolbarIds={toolbar} />
    </section>}

    {view === "settings" && <section className="space-y-6 px-4 pb-8">
      <div className="space-y-2">
        <h2 className="font-semibold">Backup</h2>
        <button className="app-button" disabled={busy} onClick={() => run(exportFile)}>Export backup</button>
        <p className="text-sm text-gray-600">Last backup: {lastBackupAt ? new Date(lastBackupAt).toLocaleString() : "Not yet exported"}</p>
      </div>
      <div className="space-y-3">
        <label className="block font-semibold" htmlFor="backup-file">Import backup</label>
        <input id="backup-file" type="file" accept=".json,application/json" disabled={busy} className="block w-full text-sm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setPreview(null);
            run(async () => {
              await queue.flush();
              const result = validateBackup(await readFileAsText(file));
              setPreview({ name: file.name, result });
            });
          }} />
        {preview && <div className="space-y-2 rounded border border-gray-300 p-3 text-sm">
          <p className="break-all">{preview.name}</p>
          <p>{preview.result.summary.notes} notes ({preview.result.summary.trashed} in Trash), {preview.result.summary.folders} folders, {preview.result.summary.tombstones} deletion records.</p>
          {preview.result.summary.willUpgrade && <p>This file will be upgraded to the current format.</p>}
          {preview.result.errors.map((error, index) => <p role="alert" className="text-red-700" key={index}>{error}</p>)}
          {preview.result.warnings.map((warning, index) => <p className="text-amber-800" key={index}>{warning}</p>)}
          {preview.result.ok && <button className="app-button" disabled={busy} onClick={() => run(replaceFromPreview)}>Replace notebook</button>}
        </div>}
      </div>
      <div className="space-y-2 text-sm">
        <p>Persistent storage: {persisted === "unavailable" ? "Unavailable in this browser" : persisted === undefined ? "Not requested yet" : persisted ? "Granted" : "Not granted"}</p>
        <p>App version: {APP_VERSION} · Schema version: {SCHEMA_VERSION}</p>
      </div>
    </section>}
  </main>;
}
