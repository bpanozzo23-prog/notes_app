import { db } from "../db/db.js";
import { fromClaudeHtml, normalizeBody } from "../claude/html.js";
import { validateTitle } from "../claude/proposals.js";
import { diffNoteBodies } from "../claude/diff.js";
import { extractFileIds } from "../lib/text.js";
import { isSafeId } from "../lib/ids.js";
import { nowIso } from "../lib/dates.js";
import { auditBody, auditList } from "./audit.js";
import { appendOutbox, outboxId, readOutbox } from "./prefs.js";
import { syncSession } from "./session.js";

export const STALE_XPS = "You edited this note after Claude Code read it, so this suggestion can't be applied. Claude Code's version is kept on the XPS.";
export function pendingProposals(proposals, outbox = []) {
  const handled = new Set(outbox.map(outboxId)), byNote = new Map();
  for (const proposal of [...proposals].sort((a, b) => a.sequence - b.sequence)) {
    if (proposal.status === "pending") byNote.set(proposal.note, proposal);
  }
  return [...byNote.values()].filter((proposal) => !handled.has(outboxId(proposal))).sort((a, b) => a.sequence - b.sequence);
}
export function proposalIsStale(proposal, note, generation) {
  return !note || note.deletedAt !== null || note.rev !== proposal.basedOnRev || generation !== proposal.generation;
}
export function buildInbox(proposals, { notes, folders, generation, outbox = [] }) {
  const noteHandles = new Map(notes.filter((note) => note.deletedAt === null).map(({ id }) => [id, id]));
  return pendingProposals(proposals, outbox).map((version) => {
    const note = notes.find((note) => note.id === version.note);
    const model = { key: outboxId(version), version, note, generation, folders,
      stale: proposalIsStale(version, note, generation), title: null, tags: null, folder: { action: "keep" }, changes: [], ids: [], audit: [] };
    try {
      const before = note ?? { title: "", html: "<p></p>", tags: [], folderId: null };
      const handles = { noteHandles, imageHandles: new Map(extractFileIds(before.html).map((id) => [id, id])) };
      if (typeof version.body !== "string") throw new Error();
      const audit = auditBody(version.body, handles);
      const clean = fromClaudeHtml(version.body, handles);
      model.audit = auditList(audit, clean.report);
      model.html = normalizeBody(clean.html);
      model.report = clean.report;
      const title = validateTitle(version.title);
      if (title !== before.title) model.title = title;
      if (!Array.isArray(version.tags) || version.tags.length > 50 || version.tags.some((tag) => !isSafeId(tag) || tag !== tag.trim()) || new Set(version.tags).size !== version.tags.length) throw new Error();
      if (JSON.stringify([...version.tags].sort()) !== JSON.stringify([...before.tags].sort())) model.tags = [...version.tags];
      const folder = folders.find(({ id }) => id === version.folderId);
      if (version.folderId !== null && !folder) throw new Error();
      if (version.folderId !== before.folderId) model.folder = folder ? { action: "existing", id: folder.id, name: folder.name } : { action: "none", name: null };
      const prefix = `${version.proposal}:${version.hash}:`;
      model.ticks = { title: `${prefix}title`, tags: `${prefix}tags`, folder: `${prefix}folder` };
      model.changes = diffNoteBodies(normalizeBody(before.html), model.html).map((change) => change.id ? { ...change, id: prefix + change.id } : change);
      model.ids = [model.title !== null && model.ticks.title, model.tags !== null && model.ticks.tags, model.folder.action !== "keep" && model.ticks.folder,
        ...model.changes.map((change) => change.id)].filter(Boolean);
    } catch {
      // A malformed version remains dismissible, but none of it can reach a write plan.
      model.invalid = true;
      model.ids = [];
    }
    return model;
  });
}
export function readInboxSnapshot() {
  return db.transaction("r", db.notes, db.folders, db.prefs, async () => {
    const [notes, folders, saved, outbox] = await Promise.all([db.notes.toArray(), db.folders.toArray(), db.prefs.get("notebookGeneration"), readOutbox()]);
    return { notes, folders, generation: saved?.value ?? null, outbox };
  });
}
export async function dismissProposal(card) {
  const entry = { proposal: card.version.proposal, hash: card.version.hash, outcome: card.stale ? "stale" : "dismissed", applied: [], at: nowIso() };
  await appendOutbox(entry);
  syncSession.hideProposals([entry]);
}
