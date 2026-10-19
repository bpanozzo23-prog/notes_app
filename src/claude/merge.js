import { db } from "../db/db.js";
import { checkGeneration, deepFreeze } from "./payload.js";
import { noteTitle } from "../lib/notebookView.js";
import { extractNoteLinks, extractFileIds, htmlToText, retargetNoteLinks } from "../lib/text.js";
import { nowIso } from "../lib/dates.js";
import { toClaudeHtml, fromClaudeHtml } from "./html.js";
import { lineChanges, effects } from "./diff.js";
import { folderSchema, shape, validateTitle, validateFolder, handleMaps, runProposal, tidyPlan } from "./proposals.js";
import { isSafeId } from "../lib/ids.js";
import { MERGE_SYSTEM_PROMPT } from "./prompts.js";
import { CLAUDE_MODEL, PROPOSAL_EFFORT, PROPOSAL_MAX_TOKENS } from "./config.js";
import { RESPONSE_ERRORS } from "./client.js";

export const MERGE_TASK = "Merge these notes into one note.";
const properties = { summary: { type: "string" }, title: { type: "string" }, html: { type: "string" }, tags: { type: "array", items: { type: "string" } }, folder: folderSchema, reason: { type: "string" } };
export const MERGE_SCHEMA = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
const byAge = (a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export async function captureMergePayload(noteIds) {
  if (!Array.isArray(noteIds) || noteIds.length < 2 || noteIds.length > 5 || new Set(noteIds).size !== noteIds.length) throw new Error("Choose 2–5 distinct notes to merge.");
  return db.transaction("r", db.notes, db.folders, db.files, db.prefs, async () => {
    const generation = await checkGeneration();
    const [live, rows] = await Promise.all([db.notes.filter((note) => note.deletedAt === null).toArray(), db.folders.toArray()]);
    live.sort(byAge);
    const group = live.filter((note) => noteIds.includes(note.id));
    if (group.length !== noteIds.length) throw new Error("A note in this merge is no longer available.");
    const noteHandles = new Map(live.map((note, index) => [note.id, `N${index + 1}`])), imageHandles = new Map();
    for (const note of group) for (const id of extractNoteLinks(note.html)) if (!noteHandles.has(id)) noteHandles.set(id, `N${noteHandles.size + 1}`);
    const notes = group.map((note) => ({ ...Object.fromEntries(["id", "rev", "updatedAt", "createdAt", "title", "html", "folderId", "tags", "pinned"].map((key) => [key, note[key]])), displayTitle: noteTitle(note), handle: noteHandles.get(note.id) }));
    const folders = rows.map(({ id, name }) => ({ id, name })), tags = [...new Set(live.flatMap((note) => note.tags))].sort();
    const otherNotes = live.filter((note) => !noteIds.includes(note.id)).map((note) => ({ id: note.id, title: noteTitle(note), handle: noteHandles.get(note.id) }));
    const bodies = notes.map((note) => toClaudeHtml(note.html, { noteHandles, imageHandles }).html);
    const sourceIds = notes.slice(1).map((note) => note.id);
    const backlinks = (await db.notes.where("linkedIds").anyOf(sourceIds).distinct().filter((note) => note.deletedAt === null && !noteIds.includes(note.id)).toArray()).sort(byAge)
      .map((note) => ({ id: note.id, rev: note.rev, html: note.html, displayTitle: noteTitle(note) }));
    const requestText = JSON.stringify({ task: MERGE_TASK, notebookData: { notes: notes.map((note, index) => ({ handle: note.handle, title: note.title,
      folder: folders.find((folder) => folder.id === note.folderId)?.name ?? null, tags: note.tags, html: bodies[index] })),
      folders: folders.map((folder) => folder.name), tagsInUse: tags, otherNotes: otherNotes.map((note) => `${note.handle} · ${note.title}`) } });
    return deepFreeze({ kind: "merge", generation, capturedAt: nowIso(), notes, keepId: notes[0].id, folders, tags, otherNotes,
      handles: { noteHandles: [...noteHandles], imageHandles: [...imageHandles] }, backlinks, claudeHtml: bodies.join(""), requestText, system: MERGE_SYSTEM_PROMPT });
  });
}
export function validateTags(tags) {
  const clean = tags.map((tag) => tag.trim());
  if (clean.length > 50 || clean.some((tag) => !isSafeId(tag)) || new Set(clean).size !== clean.length) throw new Error();
  return clean;
}
export const hasBody = (html) => !!htmlToText(html).trim() || extractFileIds(html).length > 0;
export function validateMergeProposal(raw, payload) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    if (!shape(value, MERGE_SCHEMA)) throw new Error();
    const kept = payload.notes[0], groupIds = new Set(payload.notes.map((note) => note.id));
    value.title = validateTitle(value.title); value.tags = validateTags(value.tags);
    value.folder = validateFolder(value.folder, kept, payload.folders);
    const clean = fromClaudeHtml(value.html, handleMaps(payload.handles), { dropLinksTo: groupIds });
    value.html = clean.html;
    if (!hasBody(value.html) || extractNoteLinks(value.html).some((id) => groupIds.has(id))) throw new Error();
    value.pinned = payload.notes.some((note) => note.pinned);
    value.groupLinksRemoved = clean.report.filter((item) => item.type === "removed-group-link").length;
    value.report = clean.report;
    value.droppedTags = [...new Set(payload.notes.flatMap((note) => note.tags))].filter((tag) => !value.tags.includes(tag))
      .map((tag) => ({ tag, from: payload.notes.filter((note) => note.tags.includes(tag)).map((note) => note.displayTitle) }));
    const targets = new Map(payload.notes.slice(1).map((note) => [note.id, kept.id]));
    value.retargeted = Object.fromEntries(payload.backlinks.map((note) => {
      const html = retargetNoteLinks(note.html, targets);
      if (html === note.html || extractNoteLinks(html).some((id) => targets.has(id))) throw new Error();
      return [note.id, html];
    }));
    value.lines = lineChanges(payload.notes.map((note) => ({ title: note.displayTitle, html: note.html })), [{ title: value.title || noteTitle({ title: "", text: htmlToText(value.html) }), html: value.html }]);
    value.effects = effects(payload.notes.map((note) => note.html), [value.html]).filter((effect) => effect.type !== "link-removed" || !/^note:/i.test(effect.href.trim()) || !groupIds.has(effect.href.trim().slice(5)));
    value.noChanges = false;
    return deepFreeze(value);
  } catch { throw new Error(RESPONSE_ERRORS.invalid); }
}
export function mergePlan(payload, proposal) {
  const kept = payload.notes[0];
  const base = tidyPlan({ ...payload, note: kept }, { ...proposal, changes: [] }, ["title", "tags", "folder"]);
  base.notes[0].role = "content";
  Object.assign(base.notes[0].patch, { html: proposal.html, pinned: proposal.pinned, folderId: base.notes[0].patch.folderId ?? (proposal.folder.action === "none" ? null : kept.folderId) });
  return { ...base, kind: "merge", expectedNewFolders: base.createFolders.map((folder) => folder.name), notes: [...base.notes,
    ...payload.notes.slice(1).map((note) => ({ id: note.id, expectedRev: note.rev, role: "trashed", patch: { deletedAt: nowIso() } })),
    ...payload.backlinks.map((note) => ({ id: note.id, expectedRev: note.rev, role: "relinked", housekeeping: true, patch: { html: proposal.retargeted[note.id] } }))],
    backlinkCheck: { sourceIds: payload.notes.slice(1).map((note) => note.id), groupIds: payload.notes.map((note) => note.id), noteIds: payload.backlinks.map((note) => note.id) } };
}
export function buildMergeRequest(payload) {
  return { model: CLAUDE_MODEL, max_tokens: PROPOSAL_MAX_TOKENS, output_config: { effort: PROPOSAL_EFFORT, format: { type: "json_schema", schema: MERGE_SCHEMA } }, system: payload.system, messages: [{ role: "user", content: payload.requestText }] };
}
export const runMerge = (options) => runProposal({ ...options, buildRequest: buildMergeRequest, validate: validateMergeProposal });
