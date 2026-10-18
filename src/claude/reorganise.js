import { db } from "../db/db.js";
import { checkGeneration, deepFreeze } from "./payload.js";
import { noteTitle } from "../lib/notebookView.js";
import { isSafeId } from "../lib/ids.js";
import { noteToClaudeText } from "./projection.js";
import { nullableString, folderSchema, shape, validateTitle, validateFolder, runProposal } from "./proposals.js";
import { REORGANISE_SYSTEM_PROMPT } from "./prompts.js";
import { CLAUDE_MODEL, PROPOSAL_EFFORT, PROPOSAL_MAX_TOKENS } from "./config.js";
import { RESPONSE_ERRORS } from "./client.js";

export const STALE_REORGANISE = "Some notes changed since Claude read them. Ask again.";
export const REORGANISE_TASK = "Suggest better titles, tags and folders across this notebook.";
const changeProperties = { note: { type: "string" }, title: nullableString, folder: folderSchema,
  addTags: { type: "array", items: { type: "string" } }, removeTags: { type: "array", items: { type: "string" } }, reason: { type: "string" } };
export const REORGANISE_SCHEMA = { type: "object", properties: { summary: { type: "string" }, changes: { type: "array", items: {
  type: "object", properties: changeProperties, required: Object.keys(changeProperties), additionalProperties: false,
} } }, required: ["summary", "changes"], additionalProperties: false };

export async function captureReorganisePayload() {
  return db.transaction("r", db.notes, db.folders, db.prefs, async () => {
    const generation = await checkGeneration();
    const [live, rows] = await Promise.all([db.notes.filter((note) => note.deletedAt === null).toArray(), db.folders.toArray()]);
    live.sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const lookup = new Map(live.map((note) => [note.id, note]));
    const folders = rows.map(({ id, name }) => ({ id, name }));
    const notes = live.map((note, index) => ({ ...Object.fromEntries(["id", "rev", "updatedAt", "title", "folderId", "tags", "html"].map((key) => [key, note[key]])),
      handle: `N${index + 1}`, text: noteToClaudeText(note.html, lookup), displayTitle: noteTitle(note) }));
    const counts = new Map();
    for (const note of notes) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const tagsInUse = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({ tag, count }));
    const requestText = JSON.stringify({ task: REORGANISE_TASK, notes: notes.map((note) => ({ handle: note.handle, title: note.displayTitle,
      storedTitle: note.title, folder: folders.find((folder) => folder.id === note.folderId)?.name ?? null, tags: note.tags, text: note.text })),
      folders: folders.map((folder) => folder.name), tagsInUse });
    return deepFreeze({ kind: "reorganise", generation, capturedAt: new Date().toISOString(), notes, folders, tagsInUse, requestText, system: REORGANISE_SYSTEM_PROMPT });
  });
}
export function buildReorganiseRequest(payload) {
  return { model: CLAUDE_MODEL, max_tokens: PROPOSAL_MAX_TOKENS, output_config: { effort: PROPOSAL_EFFORT, format: { type: "json_schema", schema: REORGANISE_SCHEMA } },
    system: payload.system, messages: [{ role: "user", content: payload.requestText }] };
}
export function validateReorganiseProposal(raw, payload) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    if (!shape(value, REORGANISE_SCHEMA) || value.changes.length > 40) throw new Error();
    const seen = new Set(), newFolders = new Map();
    value.changes = value.changes.map((change) => {
      const note = payload.notes.find((note) => note.handle === change.note);
      if (!note || seen.has(change.note)) throw new Error();
      seen.add(change.note);
      if (change.title !== null) { change.title = validateTitle(change.title); if (change.title === note.title) change.title = null; }
      for (const key of ["addTags", "removeTags"]) {
        change[key] = [...new Set(change[key].map((tag) => tag.trim()))];
        if (change[key].some((tag) => !isSafeId(tag) || tag.length > 512)) throw new Error();
      }
      // A tag both added and removed is a contradiction; redundant ones (adding a tag the note has,
      // removing one it lacks) are harmless and dropped rather than wasting the whole request.
      if (change.addTags.some((tag) => change.removeTags.includes(tag))) throw new Error();
      change.addTags = change.addTags.filter((tag) => !note.tags.includes(tag));
      change.removeTags = change.removeTags.filter((tag) => note.tags.includes(tag));
      change.tags = [...note.tags.filter((tag) => !change.removeTags.includes(tag)), ...change.addTags];
      if (change.tags.length > 50 || new Set(change.tags).size !== change.tags.length) throw new Error();
      change.folder = validateFolder(change.folder, note, payload.folders);
      if (change.folder.action === "create") {
        const key = change.folder.name.toLowerCase();
        if (!newFolders.has(key)) newFolders.set(key, change.folder.name);
        change.folder.name = newFolders.get(key);
      }
      return change;
    }).filter((change) => change.title !== null || change.folder.action !== "keep" || change.addTags.length || change.removeTags.length);
    value.noChanges = !value.changes.length;
    return deepFreeze(value);
  } catch { throw new Error(RESPONSE_ERRORS.invalid); }
}
export const reorganiseRowIds = (change) => [change.title !== null && "title", change.folder.action !== "keep" && "folder", (change.addTags.length || change.removeTags.length) && "tags"].filter(Boolean).map((field) => `${change.note}:${field}`);
export const reorganiseItemIds = (proposal) => proposal.changes.flatMap(reorganiseRowIds);
export function reorganisePlan(payload, proposal, ticked, titles = {}) {
  const selected = new Set(ticked), folderChecks = new Map(), creates = new Set(), expectedNewFolders = new Set();
  // Keep all affected notes in the plan, including unticked ones, so one stale note refuses all.
  const notes = proposal.changes.map((change) => {
    const note = payload.notes.find((note) => note.handle === change.note), patch = {};
    const source = payload.folders.find((folder) => folder.id === note.folderId);
    if (source) folderChecks.set(source.id, source);
    const folder = change.folder;
    if (folder.action === "existing") folderChecks.set(folder.id, { id: folder.id, name: folder.name });
    if (folder.action === "create") expectedNewFolders.add(folder.name);
    if (selected.has(`${change.note}:title`) && change.title !== null) patch.title = validateTitle(titles[change.note] ?? change.title);
    if (selected.has(`${change.note}:tags`)) patch.tags = change.tags;
    if (selected.has(`${change.note}:folder`)) {
      if (folder.action === "create") { creates.add(folder.name); patch.folderId = { create: folder.name }; }
      if (folder.action === "existing") patch.folderId = folder.id;
      if (folder.action === "none") patch.folderId = null;
    }
    return { id: note.id, expectedRev: note.rev, patch };
  });
  return { generation: payload.generation, notes, folderChecks: [...folderChecks.values()], createFolders: [...creates].map((name) => ({ name })), expectedNewFolders: [...expectedNewFolders] };
}
export const runReorganise = (options) => runProposal({ ...options, buildRequest: buildReorganiseRequest, validate: validateReorganiseProposal, staleMessage: STALE_REORGANISE });
