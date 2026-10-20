import { db, writeTransaction } from "../db/db.js";
import { fromClaudeHtml, normalizeBody } from "../claude/html.js";
import { validateTitle, validateFolder } from "../claude/proposals.js";
import { hasBody } from "../claude/merge.js";
import { diffNoteBodies, effects } from "../claude/diff.js";
import { extractFileIds, extractNoteLinks } from "../lib/text.js";
import { noteTitle } from "../lib/notebookView.js";
import { isSafeId } from "../lib/ids.js";
import { nowIso } from "../lib/dates.js";
import { auditBody, auditList } from "./audit.js";
import { appendOutboxInTransaction, appendHandledInTransaction, outboxId, readOutbox, readHandled } from "./prefs.js";
import { syncSession } from "./session.js";

export const STALE_XPS = "You edited this note after Claude Code read it, so this suggestion can't be applied. Claude Code's version is kept on the XPS.";
export const STALE_KEEP_BOTH = "You edited this note after Claude Code read it, so this suggestion can't be applied. Keep both adds Claude Code's version as a separate note.";
export const STALE_TRASH = "This note changed after Claude Code read it, so moving it to Trash can't be applied.";
export const STALE_GENERATION = "The notebook was replaced since Claude Code wrote this, so it can't be applied.";
export const proposalKind = (version) => Object.hasOwn(version, "trash") ? "trash" : Object.hasOwn(version, "note") ? "edit" : "new";
const fields = {
  edit: ["note", "basedOnRev", "generation", "title", "folderId", "tags", "why", "body"],
  new: ["generation", "title", "folderId", "tags", "why", "body"],
  trash: ["note", "basedOnRev", "generation", "trash", "why"],
};
const envelope = ["proposal", "hash", "status", "ingestedAt", "sequence"];
const bytes = (text) => new TextEncoder().encode(text).length;
function checkShape(version) {
  const kind = proposalKind(version), required = [...fields[kind], ...envelope];
  if (required.some((key) => !Object.hasOwn(version, key)) || Object.keys(version).some((key) => !required.includes(key) && !(kind !== "trash" && key === "newFolder")) ||
      !/^p-[a-z0-9-]{3,80}$/.test(version.proposal) || !/^[a-f0-9]{64}$/.test(version.hash) ||
      version.status !== "pending" || typeof version.ingestedAt !== "string" || !Number.isFinite(Date.parse(version.ingestedAt)) ||
      !Number.isSafeInteger(version.sequence) || version.sequence < 1 ||
      version.generation !== null && typeof version.generation !== "string" || typeof version.why !== "string" || version.why.length > 300) throw new Error();
  if (kind !== "new" && (!isSafeId(version.note) || !Number.isSafeInteger(version.basedOnRev) || version.basedOnRev < 1)) throw new Error();
  if (kind === "trash") { if (version.trash !== true) throw new Error(); }
  else {
    if (typeof version.body !== "string" || bytes(version.body) > 512 * 1024 || typeof version.title !== "string" || version.title.length > 200) throw new Error();
    validateTitle(version.title);
    if (version.folderId !== null && !isSafeId(version.folderId) || Object.hasOwn(version, "newFolder") &&
        (version.folderId !== null || !isSafeId(version.newFolder) || version.newFolder !== version.newFolder.trim())) throw new Error();
    checkTags(version.tags);
  }
  const details = Object.fromEntries(Object.entries(version).filter(([key]) => !envelope.includes(key) && key !== "body"));
  if (bytes(JSON.stringify(details)) > 16 * 1024) throw new Error();
}
function checkTags(tags) {
  if (!Array.isArray(tags) || tags.length > 50 || tags.some((tag) => !isSafeId(tag) || tag !== tag.trim()) || new Set(tags).size !== tags.length) throw new Error();
  return [...tags];
}
export function pendingProposals(proposals, outbox = [], handled = []) {
  const hidden = new Set([...outbox, ...handled].map(outboxId)), byTarget = new Map();
  for (const version of [...proposals].sort((a, b) => a.sequence - b.sequence)) {
    if (version.status === "pending") byTarget.set(JSON.stringify(proposalKind(version) === "new" ? ["new", version.proposal] : ["note", version.note]), version);
  }
  return [...byTarget.values()].filter((version) => !hidden.has(outboxId(version))).sort((a, b) => a.sequence - b.sequence);
}
export function handledMessage(version, handled, generation) {
  const prior = proposalKind(version) === "new" && handled.find((entry) => entry.pid === version.proposal && entry.generation === generation);
  return prior ? ["applied", "kept"].includes(prior.outcome) ? "You already added this note." : "You already dismissed this note." : "";
}
export const handledEntry = (version, generation, outcome) => ({ proposal: version.proposal, hash: version.hash,
  ...(proposalKind(version) === "new" ? { pid: version.proposal } : {}), generation, outcome });
export function proposalIsStale(version, note, generation) {
  return generation !== version.generation || proposalKind(version) !== "new" && (!note || note.deletedAt !== null || note.rev !== version.basedOnRev);
}
export function resolveFolder(version, folders) {
  if (Object.hasOwn(version, "newFolder")) {
    const folder = validateFolder({ action: "create", name: version.newFolder }, {}, folders);
    return { ...folder, ...(folder.action === "existing" ? { byName: true } : {}) };
  }
  if (version.folderId === null) return { action: "none", name: null };
  const folder = folders.find(({ id }) => id === version.folderId);
  if (!folder) throw new Error();
  return { action: "existing", id: folder.id, name: folder.name };
}
function cleanBody(body, notes, imageNotes) {
  const handles = { noteHandles: new Map(notes.filter((note) => note.deletedAt === null).map(({ id }) => [id, id])),
    imageHandles: new Map(imageNotes.flatMap((note) => extractFileIds(note.html)).map((id) => [id, id])) };
  const audit = auditBody(body, handles), clean = fromClaudeHtml(body, handles);
  return { html: normalizeBody(clean.html), report: clean.report, audit: auditList(audit, clean.report) };
}
export function newNoteModel(version, { notes, folders }, imageNotes = notes.filter((note) => note.deletedAt === null)) {
  const model = { ...cleanBody(version.body, notes, imageNotes), title: validateTitle(version.title), tags: checkTags(version.tags), folder: resolveFolder(version, folders) };
  if (!hasBody(model.html)) throw new Error();
  return { ...model, effects: effects([], [model.html]), ids: [`${version.proposal}:${version.hash}:note`] };
}
export function buildInbox(proposals, { notes, folders, generation, outbox = [], handled = [] }) {
  return pendingProposals(proposals, outbox, handled).map((version) => {
    const kind = proposalKind(version), note = notes.find((note) => note.id === version.note);
    const model = { key: outboxId(version), version, kind, note, generation, folders,
      stale: proposalIsStale(version, note, generation), title: null, tags: null, folder: { action: "keep" }, changes: [], ids: [], audit: [],
      handledMessage: handledMessage(version, handled, generation) };
    try {
      checkShape(version);
      if (kind === "new") Object.assign(model, newNoteModel(version, { notes, folders }));
      else if (kind === "trash") Object.assign(model, { html: note?.html ?? "<p></p>",
        backlinks: notes.filter((n) => n.deletedAt === null && n.id !== version.note && n.linkedIds.includes(version.note)).map(noteTitle),
        ids: [`${version.proposal}:${version.hash}:trash`] });
      else {
        const before = note ?? { title: "", html: "<p></p>", tags: [], folderId: null };
        Object.assign(model, cleanBody(version.body, notes, [before]));
        const title = validateTitle(version.title);
        if (title !== before.title) model.title = title;
        if (JSON.stringify([...version.tags].sort()) !== JSON.stringify([...before.tags].sort())) model.tags = [...version.tags];
        const folder = resolveFolder(version, folders);
        if (folder.action === "create" || (folder.id ?? null) !== before.folderId) model.folder = folder;
        // Even a name resolving back to the source folder must stay unambiguous at Apply.
        model.resolvedFolder = folder;
        const prefix = `${version.proposal}:${version.hash}:`;
        model.ticks = { title: `${prefix}title`, tags: `${prefix}tags`, folder: `${prefix}folder` };
        model.changes = diffNoteBodies(normalizeBody(before.html), model.html).map((change) => change.id ? { ...change, id: prefix + change.id } : change);
        model.ids = [model.title !== null && model.ticks.title, model.tags !== null && model.ticks.tags, model.folder.action !== "keep" && model.ticks.folder,
          ...model.changes.map((change) => change.id)].filter(Boolean);
      }
    } catch {
      // A malformed version remains dismissible, but none of it can reach a write plan.
      model.invalid = true; model.ids = [];
    }
    return model;
  });
}
// Unused clocks are housekeeping, not a change to a picture shown in the sheet.
export const pictureCheck = ({ unusedSince, ...file }) => file;
export function keepBothModel(version, snapshot) {
  checkShape(version);
  const { notes, folders, files = [], generation, outbox = [], handled = [] } = snapshot;
  const source = notes.find(({ id }) => id === version.note);
  if (proposalKind(version) !== "edit" || version.generation !== generation || !proposalIsStale(version, source, generation) ||
      [...outbox, ...handled].some((entry) => outboxId(entry) === outboxId(version))) throw new Error("This suggestion is no longer available.");
  const suffix = " (from Claude Code)", base = validateTitle(version.title) || source?.title || "Untitled";
  const folderId = folders.some(({ id }) => id === source?.folderId) ? source.folderId : null;
  const { newFolder, ...details } = version;
  const copy = newNoteModel({ ...details, title: base.slice(0, 200 - suffix.length).trimEnd() + suffix, folderId }, snapshot, notes);
  return { ...copy, version, generation, sourceCheck: { id: version.note, rev: source?.rev ?? null },
    folderChecks: copy.folder.action === "existing" ? [{ id: copy.folder.id, name: copy.folder.name }] : [],
    linkChecks: extractNoteLinks(copy.html).map((id) => ({ id, rev: notes.find((note) => note.id === id).rev })),
    fileChecks: extractFileIds(copy.html).map((id) => { const file = files.find((file) => file.id === id); if (!file) throw new Error("A picture is no longer available."); return pictureCheck(file); }),
    titles: new Map(notes.filter((note) => note.deletedAt === null).map((note) => [note.id, noteTitle(note)])) };
}
export function readInboxSnapshot() {
  return db.transaction("r", db.notes, db.folders, db.files, db.prefs, async () => {
    const [notes, folders, files, saved, outbox, handled] = await Promise.all([db.notes.toArray(), db.folders.toArray(), db.files.toArray(), db.prefs.get("notebookGeneration"), readOutbox(), readHandled()]);
    return { notes, folders, files, generation: saved?.value ?? null, outbox, handled };
  });
}
export async function dismissProposal(card) {
  let entry;
  await writeTransaction([db.notes, db.prefs], async () => {
    if ((await readHandled()).some((item) => outboxId(item) === outboxId(card.version))) return;
    const generation = (await db.prefs.get("notebookGeneration"))?.value ?? null, note = isSafeId(card.version.note) ? await db.notes.get(card.version.note) : undefined;
    const outcome = proposalIsStale(card.version, note, generation) ? "stale" : "dismissed";
    entry = { proposal: card.version.proposal, hash: card.version.hash, outcome, applied: [], at: nowIso() };
    await appendOutboxInTransaction(entry);
    await appendHandledInTransaction([handledEntry(card.version, generation, outcome)]);
  });
  syncSession.hideProposals([entry ?? card.version]);
}
