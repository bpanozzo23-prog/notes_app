import { captureDuplicatesPayload } from "../claude/duplicates.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import ScreenHeader from "../components/ScreenHeader.jsx";
import Dialog from "../components/Dialog.jsx";
import { captureReorganisePayload } from "../claude/reorganise.js";
import { captureLinksPayload } from "../claude/links.js";
import Confirm from "../components/Confirm.jsx";
import Disclosure from "../components/Disclosure.jsx";
import Sources from "../components/Sources.jsx";
import ClaudeAnswer from "../components/ClaudeAnswer.jsx";
import { notebookAccess, ReadOnlyNotebookError, NotebookReplacedError, DATABASE_UPDATED } from "../db/db.js";
import { noteTitle } from "../lib/notebookView.js";
import { claudeSession, canStartClaudeRequest } from "../claude/session.js";
import { captureNotebookPayload, captureNotePayload, prepareNoteImages, estimateRequest } from "../claude/payload.js";
import { runAsk, aboutMoney, costLabel } from "../claude/ask.js";
import { loadClaudeSdk } from "../claude/client.js";

const labels = { stopped: "Stopped", cut: "Cut short", lost: "Connection lost" };
export default function Ask({ notes, trash, folders, openNote, queue, run, busy, onBack, onOpen, claudeReady }) {
  const state = useSyncExternalStore(claudeSession.subscribe, claudeSession.getSnapshot);
  const access = useSyncExternalStore(notebookAccess.subscribe, notebookAccess.getSnapshot);
  const conversation = state.conversation;
  const [question, setQuestion] = useState("");
  const [tidySheet, setTidySheet] = useState(false), [confirmTidy, setConfirmTidy] = useState(false);
  const [prepared, setPrepared] = useState(null), [preparingImages, setPreparingImages] = useState(false);
  const [notice, setNotice] = useState(""), [confirmNew, setConfirmNew] = useState(false);
  const [online, setOnline] = useState(navigator.onLine !== false), [clock, setClock] = useState(Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; void loadClaudeSdk().catch(() => {});
    const change = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", change); window.addEventListener("offline", change);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener("online", change); window.removeEventListener("offline", change); };
  }, []);
  // Imports invalidate both the session and any unsent disclosure.
  useEffect(() => { if (prepared && prepared.payload.generation !== notebookAccess.getGeneration()) setPrepared(null); }, [state, prepared]);
  const scope = conversation?.scope ?? state.pendingScope;
  const title = notes.find((note) => note.id === scope.noteId);
  const guard = access.replaced ? new NotebookReplacedError().message : access.readOnly ? new ReadOnlyNotebookError().message : access.versionChange ? DATABASE_UPDATED : "";
  const disabledMessage = guard || (!online ? "You're offline. Claude needs a connection." : !claudeReady ? "Turn Claude on in Settings → Claude." : "");
  const disabled = busy || !!state.request || !online || !claudeReady || !canStartClaudeRequest(access);
  const capture = () => scope.kind === "note" ? captureNotePayload(scope.noteId) : captureNotebookPayload();
  async function prepare() {
    if (disabled || !question.trim()) return;
    await run(async () => {
      await queue.flush();
      const payload = await capture();
      if (alive.current) { setPrepared({ payload, question: question.trim(), images: null, now: new Date().toISOString() }); setNotice(""); }
    });
  }
  async function prepareTidy(kind, confirmed = false) {
    if (disabled) return;
    if (!confirmed && claudeSession.getSnapshot().proposal) { setTidySheet(false); setConfirmTidy(kind); return; }
    const success = await run(async () => {
      await queue.flush();
      const payload = await ({ links: captureLinksPayload, duplicates: captureDuplicatesPayload, reorganise: captureReorganisePayload }[kind]());
      if (!claudeSession.prepareProposal(payload)) throw new Error("Wait for Claude's current request to finish.");
    });
    if (success) { setTidySheet(false); setConfirmTidy(false); onOpen({ screen: "claude-review" }); }
  }
  async function includeImages(checked) {
    if (!checked) { setPrepared({ ...prepared, images: null }); return; }
    setPreparingImages(true); setNotice("");
    try {
      const images = await prepareNoteImages(prepared.payload);
      if (!alive.current) return;
      if (images.stale) {
        setPrepared(null); // A failed recapture must not leave the old disclosure sendable.
        await run(async () => {
          await queue.flush(); const payload = await capture();
          if (alive.current) { setPrepared({ ...prepared, payload, images: null }); setNotice("The note changed. Review the new disclosure and choose images again."); }
        });
      } else setPrepared({ ...prepared, images });
    } catch { if (alive.current) setNotice("Couldn't prepare the images. Try again."); }
    finally { if (alive.current) setPreparingImages(false); }
  }
  function sendFirst() {
    if (disabled || !prepared || preparingImages) return;
    const disclosed = prepared; setPrepared(null); setQuestion("");
    void runAsk({ payload: disclosed.payload, images: disclosed.images, question: disclosed.question }); // Network outlives this screen and nav.run.
  }
  function followUp() {
    if (disabled || !question.trim()) return;
    const next = question.trim(); setQuestion(""); void runAsk({ question: next });
  }
  const estimate = conversation ? estimateRequest({ payload: conversation.payload, images: conversation.images, history: conversation.turns, question, now: clock }) : null;
  const time = conversation && new Date(conversation.payload.capturedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const capped = conversation?.turns.length >= 11;
  return <section className="pb-12">
    <ScreenHeader title="Ask Claude" onBack={onBack} busy={busy}>
      {conversation && <button className="app-button text-sm" disabled={busy} onClick={() => setConfirmNew(true)}>New question</button>}
    </ScreenHeader>
    <div className="space-y-5 px-4">
      <p className="break-words text-sm text-[var(--color-muted)]">{conversation
        ? scope.kind === "notebook" ? `Using your ${conversation.payload.entries.length} notes as of ${time}. Start a new question to include later changes.` : `Using ${conversation.payload.entries[0].title} as of ${time}.`
        : scope.kind === "notebook" ? "All your notes" : `About: ${title ? noteTitle(title) : "a deleted note"}`}</p>
      {conversation?.turns.map((turn, index) => <article key={index} aria-label={`Turn ${index + 1}`} className="space-y-3 border-b border-[var(--color-line)] pb-5">
        <p className="whitespace-pre-wrap break-words font-semibold">{turn.question}</p>
        {turn.status === "running" && !turn.display.text && <p role="status" className="text-sm text-[var(--color-muted)]">Claude is thinking… {Math.max(0, Math.floor((clock - +new Date(turn.startedAt)) / 1000))} s</p>}
        <ClaudeAnswer display={turn.display} />
        <Sources sources={turn.sources} payload={conversation.payload} notes={notes} trash={trash} folders={folders} openNote={openNote} busy={busy} />
        {turn.status !== "running" && <p className="text-xs text-[var(--color-muted)]">{costLabel(turn)}</p>}
        {labels[turn.status] && <p role="status" className="text-sm">{labels[turn.status]}</p>}
        {turn.error && turn.status !== "refused" && <p role="alert" className="text-sm">{turn.error.message}</p>}
        {turn.error?.kind === "auth" && <button className="app-button" onClick={() => onOpen({ screen: "settings-claude" })}>Open Settings → Claude</button>}
        {index === conversation.turns.length - 1 && !["running", "completed"].includes(turn.status) && !conversation.ended && <button className="app-button" disabled={disabled} onClick={() => { void runAsk({ question: turn.question, retry: true }); }}>Try again</button>}
      </article>)}
      {disabledMessage && <p role="status" className="text-sm">{disabledMessage}</p>}
      {!claudeReady && <button className="app-button" disabled={busy} onClick={() => onOpen({ screen: "settings-claude" })}>Open Settings → Claude</button>}
      {conversation?.ended ? <p role="status">{conversation.ended}</p> : capped ? <p>Start a new question</p> : (!conversation || conversation.turns[0]?.status === "completed") && <div className="space-y-3">
        <label className="block text-sm" htmlFor="ask-question">{conversation ? "Follow-up question" : "Your question"}</label>
        <textarea id="ask-question" className="w-full resize-y rounded-lg border border-[var(--color-line)] bg-transparent p-3" rows={3} enterKeyHint="send" value={question} disabled={busy} onChange={(event) => setQuestion(event.target.value)} />
        {!state.request && <button className="app-button" disabled={disabled || !question.trim()} onClick={conversation ? followUp : prepare}>{conversation ? `Send · ${aboutMoney(estimate.dollars)}` : "Send"}</button>}
      </div>}
      <button className="app-button" disabled={disabled} onClick={() => setTidySheet(true)}>Tidy the notebook</button>
      {state.request?.kind === "ask" && <button className="app-button" onClick={() => claudeSession.cancelRequest()}>Cancel</button>}
    </div>
    {tidySheet && <Dialog title="Tidy the notebook" sheet busy={busy} onClose={() => setTidySheet(false)}>
      {disabledMessage && <p role="status">{disabledMessage}</p>}
      <button className="app-button w-full" disabled={disabled} onClick={() => prepareTidy("reorganise")}>Titles, tags and folders</button>
      <button className="app-button mt-2 w-full" disabled={disabled} onClick={() => prepareTidy("links")}>Links between notes</button>
      <button className="app-button mt-2 w-full" disabled={disabled} onClick={() => prepareTidy("duplicates")}>Find duplicates to merge</button>
    </Dialog>}
    {confirmTidy && <Confirm title="Discard Claude's other proposal?" confirmLabel="Discard and continue" busy={disabled} onCancel={() => setConfirmTidy(false)} onConfirm={() => prepareTidy(confirmTidy, true)}>Only one proposal is kept at a time.</Confirm>}
    {prepared && <Disclosure prepared={prepared} busy={preparingImages} disabled={disabled} message={notice || disabledMessage} onImages={includeImages} onCancel={() => setPrepared(null)} onSend={sendFirst} />}
    {confirmNew && <Confirm title="Clear this conversation?" confirmLabel="Clear conversation" onCancel={() => setConfirmNew(false)} onConfirm={() => { claudeSession.clearConversation(); setQuestion(""); setConfirmNew(false); }}>The answers will be cleared from this session.</Confirm>}
  </section>;
}
