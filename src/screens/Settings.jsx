import { useEffect, useState } from "react";
import { COMFORTABLE_BACKUP_BYTES, buildBackup, backupFilename, importBackup, validateBackup } from "../db/backup.js";
import { fileStats } from "../db/files.js";
import { setPref } from "../db/db.js";
import { downloadJson, readFileAsText } from "../lib/file.js";
import { nowIso } from "../lib/dates.js";
import { APP_VERSION, SCHEMA_VERSION } from "../version.js";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { requestPersistence } from "../lib/persistence.js";
import Confirm from "../components/Confirm.jsx";
import { ChevronRight } from "lucide-react";

// Small images show in KB rather than "0.0 MB"; a phone's quota reads better in GB.
export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
const imageCount = (count) => `${count} ${count === 1 ? "image" : "images"}`;

export default function Settings({ cleanupError, notebook, queue, run, busy, readOnly, onBack, onOpen, setMessage, updateState, error }) {
  const [preview, setPreview] = useState(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const { notes, trash, folders, prefs, persisted, refresh } = notebook;
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
  async function replaceFromPreview() {
    await queue.flush();
    const before = await buildBackup();
    downloadJson(before, `before-import-${backupFilename()}`);
    await importBackup(preview.result.envelope);
    // A restored notebook deserves the same eviction protection as a typed one.
    await requestPersistence();
    setPreview(null);
    setConfirmImport(false);
    await refresh();
    setMessage("Backup imported. Your previous notebook's safety download was started first.");
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
      <div className="space-y-2">
        <h2 className="font-semibold">Backup</h2>
        <button className="app-button" disabled={busy || readOnly} onClick={() => run(exportFile)}>Export backup</button>
        <p className="text-sm text-[var(--color-muted)]">Last backup: {prefs.lastBackupAt ? new Date(prefs.lastBackupAt).toLocaleString() : "Not yet exported"}</p>
      </div>
      <div className="space-y-3">
        <label className="block font-semibold" htmlFor="backup-file">Import backup</label>
        <input id="backup-file" type="file" accept=".json,application/json" disabled={busy || readOnly} className="block w-full text-sm"
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
        {preview && <div className="space-y-2 rounded border border-[var(--color-line)] p-3 text-sm">
          <p className="break-all">{preview.name}</p>
          <p>{preview.result.summary.notes} notes ({preview.result.summary.trashed} in Trash), {preview.result.summary.folders} folders, {preview.result.summary.tombstones} deletion records.</p>
          <p>{imageCount(preview.result.summary.images)} ({formatSize(preview.result.summary.imageBytes)})</p>
          {preview.result.summary.willUpgrade && <p>This file will be upgraded to the current format.</p>}
          {preview.result.errors.map((error, index) => <p role="alert" className="text-red-700" key={index}>{error}</p>)}
          {preview.result.warnings.map((warning, index) => <p className="text-amber-800" key={index}>{warning}</p>)}
          {preview.result.ok && <button className="app-button" disabled={busy || readOnly} onClick={() => setConfirmImport(true)}>Replace notebook</button>}
        </div>}
      </div>
      <div className="space-y-2 text-sm">
        <h2 className="font-semibold">App</h2>
        {images && <p>Images: {images.count}, {formatSize(images.bytes)}</p>}
        {Number.isFinite(storage?.usage) && Number.isFinite(storage?.quota) && <p>Storage used: {formatSize(storage.usage)} of about {formatSize(storage.quota)} available</p>}
        {backupBytes > COMFORTABLE_BACKUP_BYTES && <p>Your backup is getting large (about {formatSize(backupBytes)}). Exports and imports may be slow on the phone.</p>}
        {cleanupError && <p role="alert">Image cleanup: {cleanupError}</p>}
        <p>App version: {APP_VERSION} · Schema version: {SCHEMA_VERSION}</p>
        <p>Persistent storage: {persisted === "unavailable" ? "Unavailable in this browser" : persisted === undefined ? "Not requested yet" : persisted ? "Granted" : "Not granted"}</p>
        <p>{updateState}</p>
        <p>Save status: {queue.status === "error" ? `Not saved — ${queue.error?.message}` : queue.status}</p>
      </div>
    </div>
    {confirmImport && <Confirm title="Replace notebook?" confirmLabel="Import and replace" busy={busy} error={error} onCancel={() => setConfirmImport(false)} onConfirm={() => run(replaceFromPreview)}>
      Replace {notes.length + trash.length} notes and {folders.length} folders with {preview.result.envelope.notes.length} notes and {preview.result.envelope.folders.length} folders? A safety backup of the current notebook will download first. Your toolbar, colours and styles will be replaced by the backup's.
    </Confirm>}
  </section>;
}
