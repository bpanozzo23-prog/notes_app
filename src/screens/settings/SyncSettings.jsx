import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import ScreenHeader from "../../components/ScreenHeader.jsx";
import Confirm from "../../components/Confirm.jsx";
import BackupImport from "../../components/BackupImport.jsx";
import { db, notebookAccess, ReadOnlyNotebookError, NotebookReplacedError, DATABASE_UPDATED } from "../../db/db.js";
import { useOverlay } from "../../lib/overlays.jsx";
import { DEFAULT_SYNC_ADDRESS } from "../../sync/config.js";
import { canSync } from "../../sync/lifecycle.js";
import { syncSession } from "../../sync/session.js";
import { connect, disconnect, syncNow, confirmReplace, dismissConfirm, restoreBackup, declineRestore, finishRestore } from "../../sync/trigger.js";
import { lastSyncedLabel, syncStatusMessage } from "../../sync/status.js";

function Titles({ label, rows }) {
  return <div className="space-y-1">
    <h3 className="font-semibold">{rows.length} {label}</h3>
    <ul className="list-disc space-y-1 pl-5">{rows.slice(0, 5).map(({ id, title }) => <li className="break-words" key={id}>{title || "Untitled note"}</li>)}</ul>
    {rows.length > 5 && <details>
      <summary className="min-h-11 cursor-pointer py-2 underline">Show all</summary>
      <ul className="list-disc space-y-1 pl-5">{rows.slice(5).map(({ id, title }) => <li className="break-words" key={id}>{title || "Untitled note"}</li>)}</ul>
    </details>}
  </div>;
}

export default function SyncSettings({ busy, readOnly, onBack, notebook, queue, run, error, setMessage }) {
  const status = useSyncExternalStore(syncSession.subscribe, syncSession.getSnapshot);
  const access = useSyncExternalStore(notebookAccess.subscribe, notebookAccess.getSnapshot);
  const [validCode, setValidCode] = useState(false), [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [preview, setPreview] = useState(null), [working, setWorking] = useState(false), [localError, setLocalError] = useState(null);
  const [now, setNow] = useState(Date.now);
  const addressInput = useRef(null), codeInput = useRef(null), addressEdited = useRef(false), alive = useRef(false), inFlight = useRef(false);
  const guarded = readOnly || !canSync(access);
  const disabled = busy || guarded;
  const showConnection = !status.connected || status.connecting || status.error?.kind === "unauthorized";
  const guardMessage = access.replaced ? new NotebookReplacedError().message : readOnly || access.readOnly ? new ReadOnlyNotebookError().message : access.versionChange ? DATABASE_UPDATED : "";
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; finishRestore(); };
  }, []);
  useEffect(() => {
    if (!showConnection) return;
    let current = true;
    addressEdited.current = false;
    // Populate only the input. Neither a saved address nor a token enters React state.
    db.prefs.get("syncAddress").then((row) => {
      if (current && !addressEdited.current && addressInput.current && typeof row?.value === "string") addressInput.current.value = row.value;
    }).catch(() => {});
    return () => { current = false; };
  }, [showConnection]);
  useEffect(() => {
    if (!status.lastSyncedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [status.lastSyncedAt]);
  useEffect(() => {
    if (guarded) { setPreview(null); setConfirmDisconnect(false); finishRestore(); }
  }, [guarded]);
  useEffect(() => { setLocalError(null); }, [status.lastResult]);
  useOverlay(!!status.confirm && !preview && !confirmDisconnect, dismissConfirm, disabled || working);

  // Network operations stay outside nav.run so Back, typing and saving stay available.
  async function perform(task) {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setWorking(true); setLocalError(null);
    try { await task(); }
    catch { if (alive.current) setLocalError("invalid"); }
    finally { inFlight.current = false; if (alive.current) setWorking(false); }
  }
  function pair(event) {
    event.preventDefault();
    if (disabled || inFlight.current || !/^\d{6}$/.test(codeInput.current?.value ?? "")) return;
    const code = codeInput.current.value, address = addressInput.current.value;
    // Clear before the first await, including rejected/expired codes.
    codeInput.current.value = ""; setValidCode(false);
    void perform(() => connect({ address, code }));
  }
  async function restore() {
    const result = await restoreBackup();
    if (!alive.current) return;
    if (result.summary) setPreview({ name: "Backup from the XPS", result });
    else { finishRestore(); setLocalError(result.kind ?? "invalid"); }
  }
  function closePreview() { setPreview(null); finishRestore(); }
  const sentence = syncStatusMessage(localError ?? status.error?.kind);
  return <section>
    <ScreenHeader title="Sync with the XPS" onBack={onBack} busy={busy} />
    <div className="space-y-4 px-4 pb-8 text-sm leading-relaxed">
      <p>Your notes are copied to your XPS over Tailscale, reachable only from your own devices, so the XPS keeps a backup and Claude Code there can read them and suggest changes you approve here. The XPS keeps every earlier version. Keep exporting a backup now and then too.</p>
      {guardMessage && <p role="alert">{guardMessage}</p>}
      {status.connected && <>
        <p className="font-semibold">{lastSyncedLabel(status.lastSyncedAt, now)}</p>
        {status.counts && <p>On the XPS: {status.counts.notes} notes, {status.counts.images} pictures</p>}
        <div className="flex flex-wrap gap-2">
          <button className="app-button primary" disabled={disabled || working || status.running || status.paused} onClick={() => perform(syncNow)}>{status.running ? "Syncing…" : "Sync now"}</button>
          <button className="app-button" disabled={disabled || working || !!preview} onClick={() => perform(restore)}>Restore from the XPS…</button>
          <button className="app-button danger" disabled={disabled} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
        </div>
      </>}
      {showConnection && <form className="space-y-3" onSubmit={pair}>
        <label className="block font-semibold" htmlFor="sync-address">Address</label>
        <input ref={addressInput} id="sync-address" defaultValue={DEFAULT_SYNC_ADDRESS} inputMode="url" autoCapitalize="off" autoComplete="off" spellCheck={false}
          className="min-h-11 w-full rounded border border-[var(--color-line)] px-3" disabled={disabled || working || status.connecting}
          onChange={() => { addressEdited.current = true; }} />
        <label className="block font-semibold" htmlFor="sync-code">Code</label>
        <input ref={codeInput} id="sync-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" aria-describedby="sync-code-hint"
          className="min-h-11 w-full rounded border border-[var(--color-line)] px-3" disabled={disabled || working || status.connecting}
          onChange={(event) => setValidCode(/^\d{6}$/.test(event.target.value))} />
        <p id="sync-code-hint">run "notes-sync pair" on the XPS</p>
        <p>Chrome will ask to let this site reach devices on your local network: tap Allow.</p>
        <button type="submit" className="app-button primary" disabled={disabled || working || status.connecting || !validCode}>{status.connecting ? "Connecting…" : "Connect"}</button>
      </form>}
      {sentence && <p role="status">{sentence}</p>}
      {status.missingImages.length > 0 && <p role="status">{status.missingImages.length} pictures referenced by notes are missing on this phone, so the XPS can't back them up.</p>}
      {status.restoreOffer && !preview && <div className="space-y-3 rounded border border-[var(--color-line)] p-3">
        <p className="font-semibold">The XPS has {status.restoreOffer.notes} notes. Restore them?</p>
        <div className="flex flex-wrap gap-2">
          <button className="app-button" disabled={disabled || working} onClick={() => perform(restore)}>Restore from the XPS instead</button>
          <button className="app-button" disabled={disabled || working} onClick={() => perform(declineRestore)}>Continue without restoring</button>
        </div>
      </div>}
      {status.confirm && !preview && <div className="space-y-3 rounded border border-[var(--color-line)] p-3">
        <h2 className="font-semibold">The XPS copy has notes this phone doesn't</h2>
        <p>{status.confirm.removed.length} notes would be removed from the XPS copy and {status.confirm.changed.length} would be replaced with this phone's versions. The XPS keeps every earlier version in its history.</p>
        <Titles label="notes would be removed" rows={status.confirm.removed} />
        <Titles label="notes would be replaced" rows={status.confirm.changed} />
        <div className="flex flex-wrap gap-2">
          <button className="app-button" disabled={disabled || working} onClick={() => perform(restore)}>Restore from the XPS instead</button>
          <button className="app-button danger" disabled={disabled || working} onClick={() => perform(confirmReplace)}>Replace the XPS copy</button>
          <button className="app-button" disabled={disabled || working} onClick={dismissConfirm}>Not now</button>
        </div>
      </div>}
      {preview && <BackupImport preview={preview} onClose={closePreview} onImported={() => finishRestore({ imported: true })}
        notebook={notebook} queue={queue} run={run} busy={busy} readOnly={guarded} error={error} setMessage={setMessage} />}
    </div>
    {confirmDisconnect && <Confirm tone="danger" title="Disconnect from the XPS?" confirmLabel="Disconnect" busy={disabled}
      onCancel={() => setConfirmDisconnect(false)} onConfirm={() => {
        setConfirmDisconnect(false); setPreview(null);
        // Disconnect can cancel a round or a restore already in flight.
        void disconnect().then((result) => { if (alive.current && result.status === "error") setLocalError(result.kind); });
      }}>The XPS keeps its copy and history.</Confirm>}
  </section>;
}
