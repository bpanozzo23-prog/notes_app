import { useEffect, useState, useSyncExternalStore } from "react";
import { liveQuery } from "dexie";
import ScreenHeader from "../components/ScreenHeader.jsx";
import NoteReviewCard from "../components/review/NoteReviewCard.jsx";
import ChangeRow from "../components/review/ChangeRow.jsx";
import ReadOnlyBody from "../components/review/ReadOnlyBody.jsx";
import TitleRow from "../components/review/TitleRow.jsx";
import TagsRow from "../components/review/TagsRow.jsx";
import FolderRow from "../components/review/FolderRow.jsx";
import StaleBanner from "../components/review/StaleBanner.jsx";
import ReviewActionBar from "../components/review/ReviewActionBar.jsx";
import ClaudeUndo from "../components/ClaudeUndo.jsx";
import { notebookAccess, NotebookReplacedError, ReadOnlyNotebookError, DATABASE_UPDATED } from "../db/db.js";
import { applyClaudeChanges, STALE_PROPOSAL } from "../db/claudeChanges.js";
import { validateTitle } from "../claude/proposals.js";
import { noteTitle } from "../lib/notebookView.js";
import { syncSession } from "../sync/session.js";
import { buildInbox, dismissProposal, pendingProposals, proposalIsStale, readInboxSnapshot, STALE_XPS } from "../sync/inbox.js";
import { outboxId } from "../sync/prefs.js";
import { inboxPlan } from "../sync/plan.js";

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export default function SyncReview({ run, queue, busy, onBack, refresh }) {
  const { proposals } = useSyncExternalStore(syncSession.subscribe, syncSession.getSnapshot);
  const access = useSyncExternalStore(notebookAccess.subscribe, notebookAccess.getSnapshot);
  const [review, setReview] = useState(null), [revision, setRevision] = useState(0);
  const [unticked, setUnticked] = useState(new Set()), [titles, setTitles] = useState({});
  const [applied, setApplied] = useState(null), [message, setMessage] = useState("");
  useEffect(() => {
    const subscription = liveQuery(readInboxSnapshot).subscribe({
      next(snapshot) {
        syncSession.hideProposals(snapshot.outbox);
        setReview((previous) => {
          const cached = revision === previous?.revision ? new Map(previous.cards.map((card) => [card.key, card])) : new Map();
          const pending = pendingProposals(proposals, snapshot.outbox);
          const fresh = new Map(buildInbox(pending.filter((version) => !cached.has(outboxId(version))), snapshot).map((card) => [card.key, card]));
          const cards = pending.map((version) => {
            const card = cached.get(outboxId(version)) ?? fresh.get(outboxId(version));
            // Keep the exact reviewed diff and ids when the source changes. Only the
            // freshness flag changes; rebuilding could silently give an old tick new words.
            return { ...card, stale: proposalIsStale(version, snapshot.notes.find(({ id }) => id === version.note), snapshot.generation) };
          });
          return { cards, generation: snapshot.generation, revision, titles: new Map(snapshot.notes.map((note) => [note.id, noteTitle(note)])) };
        });
      },
      error() { setReview(null); setMessage("Couldn't load the suggestions. Go back and try again."); },
    });
    return () => subscription.unsubscribe();
  }, [proposals, revision]);
  const cards = review?.cards ?? [];
  const guard = access.replaced ? new NotebookReplacedError().message : access.readOnly ? new ReadOnlyNotebookError().message : access.versionChange ? DATABASE_UPDATED : "";
  const disabled = busy || !!guard;
  const selected = new Set(cards.filter((card) => !card.stale && !card.invalid).flatMap((card) => card.ids.filter((id) => !unticked.has(id))));
  const noteCount = cards.filter((card) => card.ids.some((id) => selected.has(id))).length;
  const titleErrors = {};
  for (const card of cards) if (selected.has(card.ticks?.title)) {
    try { validateTitle(titles[card.key] ?? card.title); } catch (error) { titleErrors[card.key] = error.message; }
  }
  function toggle(id) {
    setUnticked((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  async function apply() {
    if (disabled || !selected.size || Object.keys(titleErrors).length) return;
    // Capture what was approved before awaiting the queue. A change during flush must refuse
    // this whole batch, never silently leave that card out of the just-approved transaction.
    const plan = inboxPlan(cards, selected, review.generation, titles);
    await run(async () => {
      await queue.flush();
      try {
        const result = await applyClaudeChanges(plan);
        syncSession.hideProposals(plan.outbox);
        setApplied({ changeId: result.changeId, count: selected.size, notes: plan.notes.length });
        setMessage("");
        await refresh();
      } catch (error) {
        if (error.message !== STALE_PROPOSAL) throw error;
        setMessage("Something changed while you were reviewing. Nothing was applied. Check the suggestions again.");
        setRevision((value) => value + 1);
        setUnticked(new Set()); setTitles({});
        await refresh();
      }
    });
  }
  const dismiss = (card) => run(async () => {
    await queue.flush();
    const snapshot = await readInboxSnapshot();
    await dismissProposal({ ...card, stale: proposalIsStale(card.version, snapshot.notes.find(({ id }) => id === card.version.note), snapshot.generation) });
  });
  return <section className="review-screen pb-[calc(120px+env(safe-area-inset-bottom))] text-[17px] leading-[1.5]">
    <ScreenHeader title="Claude Code's suggestions" onBack={onBack} busy={busy} />
    <div className="space-y-4 break-words px-4">
      {guard && <p role="status">{guard}</p>}
      {message && <p role="alert">{message}</p>}
      {applied && <div className="space-y-3 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-3">
        <p role="status">Applied {count(applied.count, "change")} to {count(applied.notes, "note")}.</p>
        <ClaudeUndo changeId={applied.changeId} run={run} queue={queue} refresh={refresh} disabled={disabled} />
      </div>}
      {!review && !message && <p role="status">Loading suggestions…</p>}
      {review && !cards.length && <p>No suggestions waiting.</p>}
      {cards.length > 0 && <div className="rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-3">
        <p className="mb-1">{count(cards.length, "note")} · from Claude Code on the XPS</p>
        <p className="text-sm text-[var(--color-muted)]">Nothing changes until you tap Apply. Undo works afterwards.</p>
      </div>}
      {cards.map((card) => {
        const before = card.note ?? { title: "", tags: [], folderId: null };
        const rowsDisabled = disabled || card.stale || card.invalid;
        const checked = (id) => !unticked.has(id);
        return <NoteReviewCard key={card.key} title={card.note ? noteTitle(card.note) : card.version.title || "Deleted note"} reason={card.version.why}
          action={{ label: "Dismiss", disabled, onClick: () => dismiss(card) }}>
          {card.stale && <StaleBanner message={STALE_XPS} />}
          {card.invalid ? <p role="alert">This suggestion can't be read safely. Dismiss it and ask Claude Code to try again.</p> : <>
            {card.ids.length > 0 && <div className="flex justify-end"><button type="button" className="min-h-11 text-sm text-[var(--color-accent)]" disabled={rowsDisabled}
              onClick={() => setUnticked((old) => { const next = new Set(old), any = card.ids.some((id) => !old.has(id)); for (const id of card.ids) any ? next.add(id) : next.delete(id); return next; })}>
              {card.ids.some(checked) ? "Untick all" : "Tick all"}
            </button></div>}
            {card.title !== null && <TitleRow before={before.title} title={titles[card.key] ?? card.title} checked={checked(card.ticks.title)} onToggle={() => toggle(card.ticks.title)} disabled={rowsDisabled}
              error={titleErrors[card.key]} onEdit={(value) => setTitles((old) => ({ ...old, [card.key]: value }))} />}
            {card.tags !== null && <TagsRow added={card.tags.filter((tag) => !before.tags.includes(tag))} removed={before.tags.filter((tag) => !card.tags.includes(tag))}
              checked={checked(card.ticks.tags)} onToggle={() => toggle(card.ticks.tags)} disabled={rowsDisabled} />}
            {card.folder.action !== "keep" && <FolderRow before={card.folders.find(({ id }) => id === before.folderId)?.name ?? "No folder"} after={card.folder.name ?? "No folder"}
              checked={checked(card.ticks.folder)} onToggle={() => toggle(card.ticks.folder)} disabled={rowsDisabled} />}
            {card.changes.map((change, index) => change.unchanged ? <details key={`same-${index}`} className="border-t border-dashed border-[var(--color-line)]">
              <summary className="min-h-11 cursor-pointer py-2 text-sm text-[var(--color-muted)]">⋯ {count(change.unchanged.length, "unchanged block")} (show)</summary>
              <ReadOnlyBody html={change.unchanged.join("")} />
            </details> : <ChangeRow key={change.id} change={change} checked={checked(change.id)} onToggle={() => toggle(change.id)} disabled={rowsDisabled} titles={review.titles} />)}
            {!card.ids.length && <p>No changes to apply.</p>}
          </>}
          {card.audit.length > 0 && <div className="my-2 rounded-[10px] bg-[var(--color-warn-bg)] px-3 py-2.5 text-[15px] text-[var(--color-warn-ink)]">Removed by the editor: {card.audit.join("; ")}.</div>}
        </NoteReviewCard>;
      })}
    </div>
    {/* No bar when nothing left could be applied (only stale or unusable suggestions remain). */}
    {cards.some((card) => !card.stale && !card.invalid && card.ids.length) && <ReviewActionBar primary={{ label: selected.size ? `Apply ${count(selected.size, "change")} to ${count(noteCount, "note")}` : "Nothing ticked", onClick: apply,
      disabled: disabled || !selected.size || !!Object.keys(titleErrors).length }} />}
  </section>;
}
