import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COMFORTABLE_BACKUP_BYTES, buildBackup, backupFilename, validateBackup } from "../db/backup.js";
import { fileStats } from "../db/files.js";
import { db, setPref } from "../db/db.js";
import { liveNotes } from "../db/notes.js";
import { allFolders } from "../db/folders.js";
import { downloadJson, downloadText, readFileAsText } from "../lib/file.js";
import { notebookToText } from "../lib/textExport.js";
import { nowIso } from "../lib/dates.js";
import { saveStatusLabel } from "../lib/saveStatus.js";
import { APP_VERSION, SCHEMA_VERSION } from "../version.js";
import ScreenHeader from "../components/ScreenHeader.jsx";
import BackupImport, { formatSize } from "../components/BackupImport.jsx";
import { syncSession } from "../sync/session.js";
import { useClaudeStatus } from "../claude/prefs.js";
import { ChevronRight } from "lucide-react";

export { formatSize } from "../components/BackupImport.jsx";

export default function Settings({ cleanupError, notebook, queue, run, busy, readOnly, onBack, onOpen, setMessage, updateState, error }) {
  const claude = useClaudeStatus(notebook.prefs);
  const [preview, setPreview] = useState(null);
  const backupInput = useRef(null);
  const sync = useSyncExternalStore(syncSession.subscribe, syncSession.getSnapshot);
  const { notes, trash, prefs, persisted, refresh } = notebook;
  const [images, setImages] = useState(null), [storage, setStorage] = useState(null);
  useEffect(() => {
    let alive = true;
    fileStats().then((stats) => { if (alive) setImages(stats); }).catch(() => {});
    navigator.storage?.estimate?.().then((estimate) => { if (alive) setStorage(estimate); }).catch(() => {});
    return () => { alive = false; };
  }, [notes, trash]);
  const backupBytes = (images?.base64Bytes ?? 0) + new Blob([JSON.stringify([...notes, ...trash])]).size;
  async function exportFile() {
    await queue.flush();
    downloadJson(await buildBackup(), backupFilename());
    await setPref("lastBackupAt", nowIso());
    await refresh();
    setMessage("Backup download started.");
  }
  async function exportText() {
    await queue.flush();
    const [notes, folders] = await db.transaction("r", db.notes, db.folders, () => Promise.all([liveNotes(), allFolders()]));
    const now = new Date();
    downloadText(notebookToText({ notes, folders, now }), `notes-text-${now.toISOString().slice(0, 19).replaceAll(":", "-")}.md`);
    setMessage("Text download started.");
  }
  return <section>
    <ScreenHeader title="Settings" onBack={onBack} busy={busy} />
    <div className="space-y-6 px-4 pb-8">
      <section>
        <h2 className="mb-2 font-semibold">Formatting</h2>
        <div className="divide-y divide-[var(--color-line)]">
          {[["settings-toolbar", "Toolbar"], ["settings-selection", "Selection pop-up"], ["settings-colours", "Colours"], ["settings-styles", "Named styles"]].map(([screen, label]) =>
            <button key={screen} className="flex min-h-11 w-full items-center justify-between py-2 text-left" disabled={busy} onClick={() => onOpen({ screen })}>
              {label}<ChevronRight size={18} aria-hidden="true" />
            </button>)}
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Claude</h2>
        <button className="flex min-h-11 w-full items-center justify-between py-2 text-left" aria-label={`Claude ${claude.ready ? "On" : "Off"}`} disabled={busy} onClick={() => onOpen({ screen: "settings-claude" })}>
          <span>Claude</span><span className="ml-auto mr-2 text-sm text-[var(--color-muted)]">{claude.ready ? "On" : "Off"}</span><ChevronRight size={18} aria-hidden="true" />
        </button>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Sync</h2>
        <button className="flex min-h-11 w-full items-center justify-between py-2 text-left" aria-label={`Sync · ${sync.connected ? "Connected" : "Off"}`} disabled={busy} onClick={() => onOpen({ screen: "settings-sync" })}>
          <span>Sync</span><span className="ml-auto mr-2 text-sm text-[var(--color-muted)]">{sync.connected ? "Connected" : "Off"}</span><ChevronRight size={18} aria-hidden="true" />
        </button>
      </section>
      <div className="space-y-2">
        <h2 className="font-semibold">Backup</h2>
        <button className="app-button primary" disabled={busy || readOnly} onClick={() => run(exportFile)}>Export backup</button>
        <p className="text-sm text-[var(--color-muted)]">Last backup: {prefs.lastBackupAt ? new Date(prefs.lastBackupAt).toLocaleString() : "Not yet exported"}</p>
        <button className="app-button" disabled={busy} onClick={() => run(exportText)}>Export notes as text</button>
        <p className="text-sm text-[var(--color-muted)]">A readable file of your notes for other apps and AI tools. No pictures or settings.</p>
      </div>
      <div className="space-y-3">
        <label className="block font-semibold" htmlFor="backup-file">Import backup</label>
        <button className="app-button" disabled={busy || readOnly} onClick={() => backupInput.current?.click()}>Choose a backup file…</button>
        <input ref={backupInput} id="backup-file" type="file" accept=".json,application/json" disabled={busy || readOnly} className="sr-only" tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setPreview(null);
            run(async () => {
              await queue.flush();
              setPreview({ name: file.name, result: validateBackup(await readFileAsText(file)) });
            });
          }} />
        {preview && <BackupImport preview={preview} onClose={() => setPreview(null)} notebook={notebook} queue={queue}
          run={run} busy={busy} readOnly={readOnly} error={error} setMessage={setMessage} />}
      </div>
      <div className="space-y-2 text-sm">
        <h2 className="font-semibold">App</h2>
        {images && <p>Images: {images.count} ({formatSize(images.bytes)})</p>}
        {Number.isFinite(storage?.usage) && Number.isFinite(storage?.quota) && <p>Storage used: {formatSize(storage.usage)} of about {formatSize(storage.quota)} available</p>}
        {backupBytes > COMFORTABLE_BACKUP_BYTES && <p>Your backup is getting large (about {formatSize(backupBytes)}). Exports and imports may be slow on the phone.</p>}
        {cleanupError && <p role="alert">Image cleanup: {cleanupError}</p>}
        <p>App version: {APP_VERSION} · Schema version: {SCHEMA_VERSION}</p>
        <p>Protected from automatic clearing: {persisted === "unavailable" ? "Not available in this browser" : persisted === undefined ? "Not asked yet" : persisted ? "Yes" : "No (export backups regularly)"}</p>
        <p>{updateState}</p>
        <p className={queue.status === "error" ? "font-semibold text-red-700" : "text-[var(--color-muted)]"}>Save status: {saveStatusLabel(queue.status)}{queue.status === "error" && ` — ${queue.error?.message}`}</p>
      </div>
    </div>
  </section>;
}
