import { useEffect, useState, useSyncExternalStore } from "react";
import { liveQuery } from "dexie";
import ScreenHeader from "../components/ScreenHeader.jsx";
import Disclosure from "../components/Disclosure.jsx";
import ChangeCard, { ReadOnlyBody } from "../components/ChangeCard.jsx";
import ClaudeUndo from "../components/ClaudeUndo.jsx";
import { claudeSession, canStartClaudeRequest } from "../claude/session.js";
import { captureTidyPayload, runTidy, tidyPlan, tidyItemIds, validateTitle } from "../claude/proposals.js";
import { costLabel } from "../claude/ask.js";
import { loadClaudeSdk } from "../claude/client.js";
import { notebookAccess, NotebookReplacedError, ReadOnlyNotebookError, DATABASE_UPDATED } from "../db/db.js";
import { applyClaudeChanges, claudePlanIsCurrent, STALE_PROPOSAL } from "../db/claudeChanges.js";

export default function ClaudeReview({ run, queue, busy, onBack, refresh, claudeReady, notes = [], trash = [] }) {
  const state = useSyncExternalStore(claudeSession.subscribe, claudeSession.getSnapshot);
  const access = useSyncExternalStore(notebookAccess.subscribe, notebookAccess.getSnapshot);
  const entry = state.proposal, proposal = entry?.proposal, payload = entry?.payload;
  const [clock, setClock] = useState(Date.now()), [online, setOnline] = useState(navigator.onLine !== false);
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    void loadClaudeSdk().catch(() => {});
    const timer = setInterval(() => setClock(Date.now()), 1000), change = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", change); window.addEventListener("offline", change);
    return () => { clearInterval(timer); window.removeEventListener("online", change); window.removeEventListener("offline", change); };
  }, []);
  useEffect(() => {
    setCurrent(null);
    if (!proposal || entry.status !== "ready") return;
    const plan = tidyPlan(payload, proposal, proposal.folder.action === "create" ? ["folder"] : []);
    const subscription = liveQuery(() => claudePlanIsCurrent(plan)).subscribe({ next: setCurrent, error: () => setCurrent(false) });
    return () => subscription.unsubscribe();
  }, [payload, proposal, entry?.status]);
  const guard = access.replaced ? new NotebookReplacedError().message : access.readOnly ? new ReadOnlyNotebookError().message : access.versionChange ? DATABASE_UPDATED : "";
  const disabled = busy || !canStartClaudeRequest(access);
  const sendMessage = guard || (!online ? "You're offline. Claude needs a connection." : !claudeReady ? "Turn Claude on in Settings → Claude." : "");
  function discard() { claudeSession.discardProposal(); onBack(); }
  async function again() {
    if (disabled || state.request) return;
    await run(async () => {
      await queue.flush();
      const next = await captureTidyPayload(payload.note.id, payload.instruction);
      claudeSession.prepareProposal(next);
    });
  }
  const selected = new Set(entry?.ticked ?? (proposal ? tidyItemIds(proposal) : []));
  const title = entry?.editedTitle ?? proposal?.title ?? "";
  let titleError = "";
  if (selected.has("title")) try { validateTitle(title); } catch (error) { titleError = error.message; }
  const toggle = (id) => { selected.has(id) ? selected.delete(id) : selected.add(id); claudeSession.updateProposal(entry.id, { ticked: [...selected] }); };
  async function apply() {
    if (disabled || current !== true || !selected.size || titleError) return;
    await run(async () => {
      await queue.flush();
      try {
        const result = await applyClaudeChanges(tidyPlan(payload, proposal, selected, title));
        claudeSession.updateProposal(entry.id, { status: "applied", applied: { changeId: result.changeId, count: selected.size } });
        await refresh();
      } catch (error) {
        if (error.message === STALE_PROPOSAL) { setCurrent(false); return; }
        throw error;
      }
    });
  }
  const titles = new Map([...(payload?.otherNotes ?? []).map((note) => [note.id, note.title]), ...(payload ? [[payload.note.id, payload.note.title || "Untitled"]] : []), ...[...notes, ...trash].map((note) => [note.id, note.title || "Untitled"])]);
  let index = 0;
  return <section className="pb-12">
    <ScreenHeader title="Review Claude's changes" onBack={onBack} busy={busy} />
    <div className="space-y-4 break-words px-4">
      {guard && <p role="status">{guard}</p>}
      {!entry && <p>This proposal is no longer available</p>}
      {entry?.status === "running" && <><p role="status">Claude is working on a proposal… {Math.max(0, Math.floor((clock - +new Date(entry.startedAt)) / 1000))} s</p><button className="app-button" onClick={() => { claudeSession.cancelRequest(); onBack(); }}>Cancel</button></>}
      {entry?.status === "failed" && <><p role="alert">{entry.error}</p><p className="text-xs">{costLabel(entry)}</p></>}
      {entry?.status === "applied" && <><p role="status">Applied {entry.applied.count} {entry.applied.count === 1 ? "change" : "changes"}.</p><ClaudeUndo changeId={entry.applied.changeId} run={run} queue={queue} refresh={refresh} disabled={disabled} /></>}
      {entry?.status === "ready" && <>
        <p>{proposal.summary}</p><p className="text-xs text-[var(--color-muted)]">{costLabel(entry)}</p>
        <h2 className="text-xl font-semibold">{payload.note.title || "Untitled"}</h2>
        {current === false && <p role="alert">{STALE_PROPOSAL}</p>}
        {proposal.noChanges ? <p>Claude suggests no changes.</p> : <>
          {proposal.title !== null && <div className="space-y-2"><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={selected.has("title")} onChange={() => toggle("title")} disabled={disabled} />Title: {payload.note.title || "Untitled"} →</label>
            <input aria-label="Proposed title" className="min-h-11 w-full rounded border p-2" value={title} disabled={disabled} onChange={(event) => claudeSession.updateProposal(entry.id, { editedTitle: event.target.value })} />
            <p className="text-sm">{proposal.titleReason}</p>{titleError && <p role="alert">{titleError}</p>}</div>}
          {proposal.tags !== null && <div><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={selected.has("tags")} onChange={() => toggle("tags")} disabled={disabled} />Tags: {[...proposal.tags.filter((tag) => !payload.note.tags.includes(tag)).map((tag) => `+ ${tag}`), ...payload.note.tags.filter((tag) => !proposal.tags.includes(tag)).map((tag) => `− ${tag}`)].join(" ")}</label><p className="text-sm">{proposal.tagsReason}</p></div>}
          {proposal.folder.action !== "keep" && <div><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={selected.has("folder")} onChange={() => toggle("folder")} disabled={disabled} />Folder: {payload.folders.find((folder) => folder.id === payload.note.folderId)?.name ?? "No folder"} → {proposal.folder.name ?? "No folder"}{proposal.folder.action === "create" ? " (new folder)" : ""}</label><p className="text-sm">{proposal.folderReason}</p></div>}
          {proposal.htmlReason && <p className="text-sm">{proposal.htmlReason}</p>}
          {proposal.report.some((item) => item.type.startsWith("removed-")) && <p className="text-sm">Unrecognised image or note-link references were removed from Claude's proposal. Review the cleaned result below.</p>}
          {proposal.changes.map((change, runIndex) => change.unchanged ? <details key={`same-${runIndex}`}><summary className="min-h-11 cursor-pointer py-2 text-sm text-[var(--color-muted)]">⋯ {change.unchanged.length} unchanged {change.unchanged.every((html) => html.startsWith("<p")) ? "paragraphs" : "blocks"} (show)</summary><ReadOnlyBody html={change.unchanged.join("")} /></details>
            : <ChangeCard key={change.id} change={change} index={++index} total={proposal.changes.filter((run) => run.id).length} checked={selected.has(change.id)} onToggle={() => toggle(change.id)} disabled={disabled} titles={titles} />)}
          <div className="flex flex-wrap gap-2"><button className="app-button" disabled={disabled} onClick={() => claudeSession.updateProposal(entry.id, { ticked: [] })}>Untick all</button>
            <button className="app-button" disabled={disabled || current !== true || !selected.size || !!titleError} onClick={apply}>Apply {selected.size} {selected.size === 1 ? "change" : "changes"}</button></div>
        </>}
      </>}
      {(entry?.status === "failed" || entry?.status === "ready" && current === false) && <button className="app-button" disabled={disabled || !!state.request} onClick={again}>Ask again</button>}
      {entry && !["running", "disclosure"].includes(entry.status) && <button className="app-button" disabled={busy} onClick={discard}>Discard</button>}
    </div>
    {entry?.status === "disclosure" && <Disclosure prepared={{ payload }} disabled={disabled || !!state.request || !!sendMessage} message={sendMessage} onClose={() => claudeSession.discardProposal()} onCancel={discard} onSend={() => { if (!disabled && !state.request && !sendMessage) void runTidy({ payload }); }} />}
  </section>;
}
