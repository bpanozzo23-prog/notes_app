import { useState } from "react";
import { buildBackup, backupFilename, importBackup } from "../db/backup.js";
import { downloadJson } from "../lib/file.js";
import { requestPersistence } from "../lib/persistence.js";
import { useOverlay } from "../lib/overlays.jsx";
import Confirm from "./Confirm.jsx";

// Small images show in KB rather than "0.0 MB"; a phone's quota reads better in GB.
export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// Both file import and XPS restore cross this one preview/approval boundary.
export default function BackupImport({ preview, onClose, onImported, notebook, queue, run, busy, readOnly, error, setMessage }) {
  const [confirmImport, setConfirmImport] = useState(false);
  useOverlay(!confirmImport, onClose, busy);
  const { notes, trash, folders, refresh } = notebook;
  const { result } = preview, { summary } = result;
  async function replaceFromPreview() {
    if (readOnly || busy || !result.ok) return;
    await queue.flush();
    const before = await buildBackup();
    downloadJson(before, `before-import-${backupFilename()}`);
    await importBackup(result.envelope);
    // A restored notebook deserves the same eviction protection as a typed one.
    await requestPersistence();
    setConfirmImport(false);
    onImported?.();
    onClose();
    await refresh();
    setMessage("Backup imported. Your previous notebook's safety download was started first.");
  }
  return <>
    <div className="space-y-2 rounded border border-[var(--color-line)] p-3 text-sm" aria-label="Import preview">
      <p className="break-all">{preview.name}</p>
      <p>{summary.notes} notes ({summary.trashed} in Trash), {summary.folders} folders, {summary.tombstones} deletion records.</p>
      <p>{summary.images} {summary.images === 1 ? "image" : "images"} ({formatSize(summary.imageBytes)})</p>
      {summary.willUpgrade && <p>This file will be upgraded to the current format.</p>}
      {result.errors.map((message, index) => <p role="alert" className="text-red-700" key={index}>{message}</p>)}
      {result.warnings.map((message, index) => <p className="text-amber-800" key={index}>{message}</p>)}
      <div className="flex flex-wrap gap-2">
        {result.ok && <button className="app-button danger" disabled={busy || readOnly} onClick={() => setConfirmImport(true)}>Replace notebook</button>}
        <button className="app-button" disabled={busy} onClick={onClose}>Cancel preview</button>
      </div>
    </div>
    {confirmImport && <Confirm tone="danger" title="Replace notebook?" confirmLabel="Import and replace" busy={busy || readOnly} error={error}
      onCancel={() => setConfirmImport(false)} onConfirm={() => run(replaceFromPreview)}>
      Replace {notes.length + trash.length} notes and {folders.length} folders with {result.envelope.notes.length} notes and {result.envelope.folders.length} folders? A safety backup of the current notebook will download first. Your toolbar, colours and styles will be replaced by the backup's.
    </Confirm>}
  </>;
}
