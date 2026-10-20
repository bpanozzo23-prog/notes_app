import DuplicatesCard from "../components/DuplicatesCard.jsx";
import { MergeReview, SplitReview } from "../components/MoveReview.jsx";
import { captureDuplicatesPayload, runDuplicates, duplicatesItemIds } from "../claude/duplicates.js";
import { captureMergePayload, runMerge, mergePlan } from "../claude/merge.js";
import { captureSplitPayload, runSplit, splitPlan } from "../claude/split.js";
import { noteTitle } from "../lib/notebookView.js";
import { htmlToText } from "../lib/text.js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { liveQuery } from "dexie";
import ScreenHeader from "../components/ScreenHeader.jsx";
import Disclosure from "../components/Disclosure.jsx";
import ChangeCard, { ReadOnlyBody } from "../components/ChangeCard.jsx";
import TitleRow from "../components/review/TitleRow.jsx";
import TagsRow from "../components/review/TagsRow.jsx";
import FolderRow from "../components/review/FolderRow.jsx";
import ReviewActionBar from "../components/review/ReviewActionBar.jsx";
import StaleBanner from "../components/review/StaleBanner.jsx";
import ReorganiseCard from "../components/ReorganiseCard.jsx";
import { captureReorganisePayload, runReorganise, reorganisePlan, reorganiseItemIds, STALE_REORGANISE } from "../claude/reorganise.js";
import LinksCard from "../components/LinksCard.jsx";
import { captureLinksPayload, runLinks, linksPlan, linksItemIds } from "../claude/links.js";
import ClaudeUndo from "../components/ClaudeUndo.jsx";
import { claudeSession, canStartClaudeRequest } from "../claude/session.js";
import { captureTidyPayload, runTidy, tidyPlan, tidyItemIds, validateTitle } from "../claude/proposals.js";
import { costLabel } from "../claude/ask.js";
import { loadClaudeSdk } from "../claude/client.js";
import { notebookAccess, NotebookReplacedError, ReadOnlyNotebookError, DATABASE_UPDATED } from "../db/db.js";
import { applyClaudeChanges, claudePlanIsCurrent, STALE_PROPOSAL } from "../db/claudeChanges.js";

const kinds = {
  duplicates: { capture: captureDuplicatesPayload, run: runDuplicates, itemIds: duplicatesItemIds },
  merge: { capture: (payload) => captureMergePayload(payload.notes.map((note) => note.id)), run: runMerge, plan: mergePlan, itemIds: () => ["merge"], stale: STALE_REORGANISE },
  split: { capture: (payload) => captureSplitPayload(payload.note.id, payload.instruction), run: runSplit, plan: splitPlan, itemIds: () => ["split"], stale: STALE_PROPOSAL },
  tidy: { capture: (payload) => captureTidyPayload(payload.note.id, payload.instruction), run: runTidy, plan: tidyPlan, itemIds: tidyItemIds, stale: STALE_PROPOSAL },
  reorganise: { capture: captureReorganisePayload, run: runReorganise, plan: reorganisePlan, itemIds: reorganiseItemIds, stale: STALE_REORGANISE },
  links: { capture: captureLinksPayload, run: runLinks, plan: linksPlan, itemIds: linksItemIds, stale: STALE_REORGANISE },
};
export default function ClaudeReview({ run, queue, busy, onBack, refresh, claudeReady, notes = [], trash = [], openNote }) {
  const state = useSyncExternalStore(claudeSession.subscribe, claudeSession.getSnapshot);
  const access = useSyncExternalStore(notebookAccess.subscribe, notebookAccess.getSnapshot);
  const entry = state.proposal, proposal = entry?.proposal, payload = entry?.payload;
  const kind = payload?.kind, actions = kinds[kind], staleMessage = actions?.stale ?? STALE_REORGANISE;
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
    if (proposal.noChanges || !actions.plan) { setCurrent(true); return; }
    const plan = actions.plan(payload, proposal, kind === "tidy" && proposal.folder.action === "create" ? ["folder"] : []);
    const subscription = liveQuery(() => claudePlanIsCurrent(plan)).subscribe({ next: setCurrent, error: () => setCurrent(false) });
    return () => subscription.unsubscribe();
  }, [payload, proposal, entry?.status, kind, actions]);
  const guard = access.replaced ? new NotebookReplacedError().message : access.readOnly ? new ReadOnlyNotebookError().message : access.versionChange ? DATABASE_UPDATED : "";
  const disabled = busy || !canStartClaudeRequest(access);
  const sendMessage = guard || (!online ? "You're offline. Claude needs a connection." : !claudeReady ? "Turn Claude on in Settings → Claude." : "");
  function closeDisclosure() {
    claudeSession.discardProposal();
    if (kind === "merge") claudeSession.restoreSuggestions();
  }
  function discard() {
    claudeSession.discardProposal();
    if (kind !== "merge" || !claudeSession.restoreSuggestions()) onBack();
  }
  async function again() {
    if (disabled || state.request) return;
    await run(async () => {
      await queue.flush();
      const next = await actions.capture(payload);
      claudeSession.prepareProposal(next);
    });
  }
  const selected = new Set(entry?.ticked ?? (proposal ? actions.itemIds(proposal) : []));
  const title = entry?.editedTitle ?? proposal?.title ?? "";
  let titleError = "";
  if (selected.has("title")) try { validateTitle(title); } catch (error) { titleError = error.message; }
  const editedTitles = entry?.editedTitles ?? {}, titleErrors = {};
  if (kind === "reorganise" && proposal) for (const change of proposal.changes) {
    if (selected.has(`${change.note}:title`)) try { validateTitle(editedTitles[change.note] ?? change.title); } catch (error) { titleErrors[change.note] = error.message; }
  }
  if (Object.keys(titleErrors).length) titleError = "Check the proposed titles.";
  const toggle = (id) => { selected.has(id) ? selected.delete(id) : selected.add(id); claudeSession.updateProposal(entry.id, { ticked: [...selected] }); };
  async function apply() {
    if (disabled || current !== true || !selected.size || titleError) return;
    await run(async () => {
      await queue.flush();
      try {
        const result = await applyClaudeChanges(actions.plan(payload, proposal, selected, kind === "tidy" ? title : editedTitles));
        claudeSession.updateProposal(entry.id, { status: "applied", applied: { changeId: result.changeId, count: selected.size, created: result.created } });
        await refresh();
      } catch (error) {
        if (error.message === STALE_PROPOSAL) { setCurrent(false); return; }
        throw error;
      }
    });
  }
  const titles = new Map([...(payload?.otherNotes ?? []).map((note) => [note.id, note.title]), ...(payload?.note ? [[payload.note.id, payload.note.title || "Untitled"]] : []), ...[...notes, ...trash].map((note) => [note.id, note.title || "Untitled"])]);
  const whole = kind === "merge" || kind === "split";
  const visibleGroups = (entry) => (entry?.proposal?.groups ?? []).map((group, index) => ({ group, index: index + 1,
    notes: group.notes.flatMap((handle) => {
      const captured = entry.payload.notes.find((note) => note.handle === handle), live = notes.find((note) => note.id === captured.id && note.deletedAt === null);
      return live ? [{ ...live, handle }] : [];
    }),
  })).filter((group) => group.notes.length >= 2);
  const groups = kind === "duplicates" ? visibleGroups(entry) : [], suggestions = visibleGroups(state.suggestions);
  const mergedTitle = kind === "merge" && proposal ? noteTitle({ title: proposal.title, text: htmlToText(proposal.html) }) : "";
  const rowsDisabled = disabled || current === false;
  const selectRows = (ids, checked) => claudeSession.updateProposal(entry.id, {
    ticked: checked ? [...new Set([...selected, ...ids])] : [...selected].filter((id) => !ids.includes(id)),
  });
  const selectAllButton = <button type="button" className="min-h-11 shrink-0 py-2.5 text-[15px] text-[var(--color-accent)]" disabled={rowsDisabled}
    onClick={() => selectRows(actions.itemIds(proposal), !selected.size)}>{selected.size ? "Untick all" : "Tick all"}</button>;
  let index = 0;
  return <section className="review-screen pb-[calc(120px+env(safe-area-inset-bottom))] text-[17px] leading-[1.5]">
    <ScreenHeader title="Review Claude's changes" onBack={onBack} busy={busy} />
    <div className="space-y-4 break-words px-4">
      {guard && <p role="status">{guard}</p>}
      {!entry && <p>This proposal is no longer available</p>}
      {entry?.status === "running" && <div className="space-y-2 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-3"><p role="status">Claude is working on a proposal… {Math.max(0, Math.floor((clock - +new Date(entry.startedAt)) / 1000))} s</p><button className="app-button" onClick={() => { claudeSession.cancelRequest(); if (kind !== "merge" || !claudeSession.restoreSuggestions()) onBack(); }}>Cancel</button></div>}
      {entry?.status === "failed" && <div className="rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-3"><p role="alert">{entry.error}</p><p className="mt-1 text-sm text-[var(--color-muted)]">{costLabel(entry)}</p></div>}
      {entry?.status === "applied" && <div className="space-y-3 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-3"><p role="status">{kind === "merge" ? `Merged ${payload.notes.length} notes into “${mergedTitle}”.` : kind === "split" ? `Split into ${entry.applied.created.length} new ${entry.applied.created.length === 1 ? "note" : "notes"}.` : `Applied ${entry.applied.count} ${entry.applied.count === 1 ? "change" : "changes"}.`}</p><ClaudeUndo changeId={entry.applied.changeId} run={run} queue={queue} refresh={refresh} disabled={disabled} />
        {whole && <button className="app-button" disabled={busy} onClick={() => openNote(kind === "merge" ? payload.keepId : payload.note.id)}>{kind === "merge" ? "Open the merged note" : "Open the note"}</button>}
        {kind === "merge" && suggestions.length > 0 && <button className="app-button" disabled={busy || !!state.request} onClick={() => claudeSession.restoreSuggestions()}>Other suggested merges ({suggestions.length})</button>}
      </div>}
      {entry?.status === "ready" && <>
        <div className="rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-3"><p className="mb-1">{proposal.summary}</p><p className="text-sm text-[var(--color-muted)]">{costLabel(entry)}</p></div>
        {current === false && <StaleBanner message={staleMessage} action={{ label: "Ask again", disabled: disabled || !!state.request, onClick: again }} />}
        {kind === "tidy" && proposal.noChanges && <h2 className="text-[22px] font-semibold">{payload.note.title || "Untitled"}</h2>}
        {["reorganise", "links"].includes(kind) && !proposal.noChanges && <div className="flex justify-end">{selectAllButton}</div>}
        {kind === "duplicates" ? groups.length ? groups.map((item) => <DuplicatesCard key={item.index} {...item} selected={selected} toggle={toggle} disabled={disabled || !!state.request} run={run} queue={queue} />) : <p>{proposal.noChanges ? "Claude found no duplicates to merge." : "No suggested merges left."}</p> : proposal.noChanges ? kind === "split" ? null : <p>Claude suggests no changes.</p> : <>
          {kind === "merge" ? <MergeReview payload={payload} proposal={proposal} titles={titles} /> : kind === "split" ? <SplitReview payload={payload} proposal={proposal} titles={titles} /> : kind === "links" ? [...new Set(proposal.links.map((link) => link.from))].map((handle) => <LinksCard key={handle} source={payload.notes.find((note) => note.handle === handle)} links={proposal.links.filter((link) => link.from === handle)} notes={payload.notes} selected={selected} toggle={toggle} disabled={rowsDisabled}
            selectRows={selectRows} />) : kind === "reorganise" ? proposal.changes.map((change) => <ReorganiseCard key={change.note} change={change} note={payload.notes.find((note) => note.handle === change.note)} folders={payload.folders} selected={selected}
            title={editedTitles[change.note] ?? change.title ?? ""} titleError={titleErrors[change.note]} toggle={toggle} disabled={rowsDisabled}
            editTitle={(value) => claudeSession.updateProposal(entry.id, { editedTitles: { ...editedTitles, [change.note]: value } })}
            selectRows={selectRows} />) : <div>
          <div className="mt-5 mb-2 flex items-center justify-between gap-2"><h2 className="min-w-0 text-[22px] font-semibold">{payload.note.title || "Untitled"}</h2>{selectAllButton}</div>
          <div>
            {proposal.title !== null && <TitleRow before={payload.note.title} title={title} checked={selected.has("title")} onToggle={() => toggle("title")} disabled={rowsDisabled} reason={proposal.titleReason} error={titleError}
              onEdit={(value) => claudeSession.updateProposal(entry.id, { editedTitle: value })} />}
            {proposal.tags !== null && <TagsRow added={proposal.tags.filter((tag) => !payload.note.tags.includes(tag))} removed={payload.note.tags.filter((tag) => !proposal.tags.includes(tag))}
              checked={selected.has("tags")} onToggle={() => toggle("tags")} disabled={rowsDisabled} reason={proposal.tagsReason} />}
            {proposal.folder.action !== "keep" && <FolderRow before={payload.folders.find((folder) => folder.id === payload.note.folderId)?.name ?? "No folder"} after={proposal.folder.name ?? "No folder"} isNew={proposal.folder.action === "create"}
              checked={selected.has("folder")} onToggle={() => toggle("folder")} disabled={rowsDisabled} reason={proposal.folderReason} />}
          </div>
          {proposal.report.some((item) => item.type.startsWith("removed-")) && <p className="text-sm">Unrecognised image or note-link references were removed from Claude's proposal. Review the cleaned result below.</p>}
          {proposal.changes.map((change, runIndex) => change.unchanged ? <details key={`same-${runIndex}`} className="border-t border-dashed border-[var(--color-line)]"><summary className="min-h-11 cursor-pointer py-2 text-sm text-[var(--color-muted)]">⋯ {change.unchanged.length} unchanged {change.unchanged.every((html) => html.startsWith("<p")) ? "paragraphs" : "blocks"} (show)</summary><ReadOnlyBody html={change.unchanged.join("")} /></details>
            : <ChangeCard key={change.id} change={change} index={++index} total={proposal.changes.filter((run) => run.id).length} checked={selected.has(change.id)} onToggle={() => toggle(change.id)} disabled={rowsDisabled} titles={titles} />)}
          {proposal.htmlReason && <p className="mt-2.5 text-sm text-[var(--color-muted)]">Claude's note on the text: {proposal.htmlReason}</p>}
          </div>}
        </>}
        <ReviewActionBar primary={kind !== "duplicates" && !proposal.noChanges ? { label: whole ? `Apply ${kind}` : `Apply ${selected.size} ${selected.size === 1 ? "change" : "changes"}`, disabled: disabled || current !== true || !selected.size || !!titleError, onClick: apply } : undefined}
          secondary={{ label: "Discard", disabled: busy, onClick: discard }} />
      </>}
      {entry?.status === "failed" && <button className="app-button" disabled={disabled || !!state.request} onClick={again}>Ask again</button>}
      {entry && ["failed", "applied"].includes(entry.status) && <button className="app-button" disabled={busy} onClick={discard}>Discard</button>}
    </div>
    {entry?.status === "disclosure" && <Disclosure prepared={{ payload }} disabled={disabled || !!state.request || !!sendMessage} message={sendMessage} onClose={closeDisclosure} onCancel={discard} onSend={() => { if (!disabled && !state.request && !sendMessage) void actions.run({ payload }); }} />}
  </section>;
}
