import { useState } from "react";
import { buildBackup, backupFilename, importBackup, validateBackup } from "../db/backup.js";
import { setPref } from "../db/db.js";
import { downloadJson, readFileAsText } from "../lib/file.js";
import { nowIso } from "../lib/dates.js";
import { APP_VERSION, SCHEMA_VERSION } from "../version.js";
import ScreenHeader from "../components/ScreenHeader.jsx";
import { requestPersistence } from "../lib/persistence.js";
import Confirm from "../components/Confirm.jsx";

export default function Settings({ notebook, queue, run, busy, readOnly, onBack, setMessage, updateState, error }) {
  const [preview, setPreview] = useState(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const { notes, trash, folders, prefs, persisted, refresh } = notebook;
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
          {preview.result.summary.willUpgrade && <p>This file will be upgraded to the current format.</p>}
          {preview.result.errors.map((error, index) => <p role="alert" className="text-red-700" key={index}>{error}</p>)}
          {preview.result.warnings.map((warning, index) => <p className="text-amber-800" key={index}>{warning}</p>)}
          {preview.result.ok && <button className="app-button" disabled={busy || readOnly} onClick={() => setConfirmImport(true)}>Replace notebook</button>}
        </div>}
      </div>
      <div className="space-y-2 text-sm">
        <h2 className="font-semibold">App</h2>
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
