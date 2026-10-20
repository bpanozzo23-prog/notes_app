import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import ScreenHeader from "../../components/ScreenHeader.jsx";
import ClaudeUndo from "../../components/ClaudeUndo.jsx";
import Confirm from "../../components/Confirm.jsx";
import { db, writeTransaction, notebookAccess, ReadOnlyNotebookError, NotebookReplacedError, DATABASE_UPDATED } from "../../db/db.js";
import { useClaudeStatus, saveClaudeKey, setClaudeEnabled, removeClaudeKey, readClaudeSpend } from "../../claude/prefs.js";
import { loadClaudeSdk, testClaudeKey } from "../../claude/client.js";
import { claudeSession, canStartClaudeRequest } from "../../claude/session.js";
import { SPEND_LIMIT_URL } from "../../claude/config.js";

export default function ClaudeSettings({ busy, readOnly, onBack, run, refresh, error, queue }) {
  const [revision, setRevision] = useState(0);
  const status = useClaudeStatus(revision);
  const access = useSyncExternalStore(notebookAccess.subscribe, notebookAccess.getSnapshot);
  const session = useSyncExternalStore(claudeSession.subscribe, claudeSession.getSnapshot);
  const [acknowledged, setAcknowledged] = useState(false), [typed, setTyped] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false), [result, setResult] = useState("");
  const [spend, setSpend] = useState(0);
  const input = useRef(null), alive = useRef(false), testingToken = useRef(null), settingsRevision = useRef(0);
  useEffect(() => {
    alive.current = true;
    void loadClaudeSdk().catch(() => {});
    return () => { alive.current = false; }; // Requests outlive this screen; results do not.
  }, []);
  useEffect(() => {
    let current = true;
    readClaudeSpend().then((value) => { if (current) setSpend(value); }).catch(() => {});
    return () => { current = false; };
  }, [revision]);
  const disabled = busy || readOnly || !canStartClaudeRequest(access);
  const checking = session.request?.token === testingToken.current && !!session.request;
  const guardMessage = access.replaced ? new NotebookReplacedError().message : readOnly || access.readOnly ? new ReadOnlyNotebookError().message : access.versionChange ? DATABASE_UPDATED : "";
  async function changed() {
    settingsRevision.current += 1;
    setResult("");
    setRevision((value) => value + 1);
    await refresh();
  }
  async function save() {
    if (disabled || !acknowledged || (!typed && !status.hasKey)) return;
    await writeTransaction([db.prefs], async () => {
      const key = input.current?.value.trim();
      if (key) await saveClaudeKey(key);
      await setClaudeEnabled(true);
    });
    if (input.current) input.current.value = "";
    setTyped(false); setAcknowledged(false);
    await changed();
  }
  async function check() {
    if (disabled || !status.ready) return;
    const request = claudeSession.beginRequest("test-key");
    if (!request) return;
    testingToken.current = request.token;
    const checkedRevision = settingsRevision.current;
    setResult("");
    try {
      const answer = await testClaudeKey({ signal: request.signal });
      if (alive.current && checkedRevision === settingsRevision.current && claudeSession.isCurrent(request.token)) {
        setResult(answer.result === "works" ? "The key works." : answer.result === "rejected" ? "Anthropic rejected this key." : answer.message);
      }
    } finally { claudeSession.endRequest(request.token); }
  }
  return <section>
    <ScreenHeader title="Claude" onBack={onBack} busy={busy} />
    <div className="space-y-4 px-4 pb-8 text-sm leading-relaxed">
      <p>Claude can answer questions about your notes and suggest tidying, when you ask. From this app, your notes go to Anthropic only when you tap Send.</p>
      {guardMessage && <p role="alert">{guardMessage}</p>}
      {status.ready ? <>
        <p className="font-semibold">On · key saved on this phone</p>
        <div className="flex flex-wrap gap-2">
          <button className="app-button" disabled={disabled || !!session.request} onClick={check}>{checking ? "Checking…" : "Test key"}</button>
          <button className="app-button" disabled={disabled} onClick={() => run(async () => { await setClaudeEnabled(false); await changed(); })}>Turn off</button>
          <button className="app-button danger" disabled={disabled} onClick={() => setConfirmRemove(true)}>Remove key</button>
        </div>
        {result && <p role="status">{result}</p>}
        <p>This month on this phone: ${spend.toFixed(2)} (estimate)</p>
      </> : <>
        <p>The API key is stored in this browser, where code on this page can read it. A spend limit in the Anthropic console bounds what a leak could cost. Backups never include the key.</p>
        <label className="flex min-h-11 items-start gap-3">
          <input className="mt-1.5" type="checkbox" checked={acknowledged} disabled={disabled} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>I have set a monthly spend limit in the Anthropic console</span>
        </label>
        <a className="inline-block min-h-11 underline" href={SPEND_LIMIT_URL} target="_blank" rel="noopener noreferrer">Anthropic console — Spend limits</a>
        <label className="block font-semibold" htmlFor="claude-api-key">Anthropic API key</label>
        <input ref={input} id="claude-api-key" aria-label="Anthropic API key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="off"
          className="min-h-11 w-full rounded border border-[var(--color-line)] px-3" disabled={disabled}
          placeholder={status.hasKey ? "Leave blank to keep the saved key" : "sk-ant-…"}
          onChange={(event) => setTyped(event.target.value.trim() !== "")} />
        <button className="app-button primary" disabled={disabled || !acknowledged || (!typed && !status.hasKey)} onClick={() => run(save)}>
          {status.hasKey && !typed ? "Turn on" : "Save key and turn on"}
        </button>
      </>}
      <ClaudeUndo settings run={run} queue={queue} refresh={refresh} disabled={disabled} />
    </div>
    {confirmRemove && <Confirm tone="danger" title="Remove the API key from this phone?" confirmLabel="Remove key" busy={disabled} error={error}
      onCancel={() => setConfirmRemove(false)} onConfirm={() => run(async () => {
        await removeClaudeKey(); setConfirmRemove(false); await changed();
      })}>Claude will be turned off.</Confirm>}
  </section>;
}
