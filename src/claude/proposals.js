import { db, notebookAccess } from "../db/db.js";
import { checkGeneration, deepFreeze, payloadIsLive, DISCLOSURE_CHANGED } from "./payload.js";
import { resolveFormatting } from "../editor/formatting.js";
import { extractNoteLinks, extractFileIds } from "../lib/text.js";
import { isSafeId } from "../lib/ids.js";
import { noteTitle } from "../lib/notebookView.js";
import { toClaudeHtml, fromClaudeHtml, normalizeBody } from "./html.js";
import { diffNoteBodies, assembleBody } from "./diff.js";
import { TIDY_SYSTEM_PROMPT } from "./prompts.js";
import { CLAUDE_MODEL, PROPOSAL_EFFORT, PROPOSAL_MAX_TOKENS, priceUsage } from "./config.js";
import { streamMessage, toClaudeError, RESPONSE_ERRORS } from "./client.js";
import { claudeSession, canStartClaudeRequest } from "./session.js";
import { addClaudeSpend } from "./prefs.js";

export const DEFAULT_TIDY_INSTRUCTION = "Fix mistakes and make the formatting consistent, changing as little as possible.";
export const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
export const folderSchema = { type: "object", properties: { action: { type: "string", enum: ["keep", "existing", "create", "none"] }, name: nullableString }, required: ["action", "name"], additionalProperties: false };
const properties = { summary: { type: "string" }, title: nullableString, titleReason: nullableString, html: nullableString, htmlReason: nullableString,
  tags: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] }, tagsReason: nullableString,
  folder: folderSchema, folderReason: nullableString };
export const TIDY_SCHEMA = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
export function validateTitle(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(value) || value.trim().length > 200) throw new Error("Use a title of at most 200 characters, without control characters.");
  return value.trim();
}
export function validateFolder(folder, note, folders) {
  if (["keep", "none"].includes(folder.action)) { if (folder.name !== null) throw new Error(); }
  else {
    if (typeof folder.name !== "string" || !isSafeId(folder.name.trim())) throw new Error();
    const name = folder.name.trim(), matches = folders.filter((item) => item.name.toLowerCase() === name.toLowerCase());
    if (matches.length > 1 || (!matches.length && folder.action === "existing")) throw new Error();
    folder = matches.length ? { action: "existing", ...matches[0] } : { action: "create", name };
  }
  if (folder.action === "existing" && folder.id === note.folderId || folder.action === "none" && note.folderId === null) folder = { action: "keep", name: null };
  return folder;
}
export async function captureTidyPayload(noteId, instruction = "") {
  instruction = instruction.trim();
  if (instruction.length > 500) throw new Error("Use an instruction of at most 500 characters.");
  return db.transaction("r", db.notes, db.folders, db.files, db.prefs, async () => {
    const generation = await checkGeneration();
    const [live, folders, colors] = await Promise.all([db.notes.filter((note) => note.deletedAt === null).toArray(), db.folders.toArray(), db.prefs.bulkGet(["textColors", "highlightColors"])]);
    live.sort((a, b) => a.id.localeCompare(b.id));
    const source = live.find((note) => note.id === noteId);
    if (!source) throw new Error("That note no longer exists or is in Trash.");
    const note = Object.fromEntries(["id", "rev", "updatedAt", "title", "html", "folderId", "tags"].map((key) => [key, source[key]]));
    const noteHandles = new Map(live.map((note, index) => [note.id, `N${index + 1}`]));
    for (const id of extractNoteLinks(note.html)) if (!noteHandles.has(id)) noteHandles.set(id, `N${noteHandles.size + 1}`);
    const { html, imageHandles } = toClaudeHtml(note.html, { noteHandles });
    const imageMetadata = (await db.files.bulkGet(extractFileIds(note.html))).filter(Boolean)
      .map(({ id, type, width, height, size }) => ({ id, type, width, height, size }));
    // Arrays are genuinely immutable when deep-frozen, unlike Object.freeze(Map).
    const handles = { noteHandles: [...noteHandles], imageHandles: [...imageHandles] };
    const formatting = resolveFormatting(Object.fromEntries(colors.filter(Boolean).map(({ key, value }) => [key, value])));
    const palette = Object.fromEntries(["textColors", "highlightColors"].map((key) => [key, formatting[key].filter((entry) => !entry.hidden).map(({ name, color }) => ({ name, color }))]));
    const otherNotes = live.filter((item) => item.id !== noteId).map((item) => ({ id: item.id, title: noteTitle(item), handle: noteHandles.get(item.id) }));
    const tags = [...new Set(live.flatMap((note) => note.tags))].sort();
    const requestText = JSON.stringify({ instruction: instruction || DEFAULT_TIDY_INSTRUCTION, notebookData: {
      note: { title: note.title, folder: folders.find((folder) => folder.id === note.folderId)?.name ?? null, tags: note.tags, html },
      folders: folders.map((folder) => folder.name), tagsInUse: tags, otherNotes: otherNotes.map((item) => `${item.handle} · ${item.title}`), palette,
    } });
    return deepFreeze({ kind: "tidy", generation, capturedAt: new Date().toISOString(), note, folders: folders.map(({ id, name }) => ({ id, name })), tags, otherNotes, palette, instruction,
      handles, imageMetadata, claudeHtml: html, requestText, system: TIDY_SYSTEM_PROMPT });
  });
}
export const handleMaps = (handles) => ({ imageHandles: new Map(handles.imageHandles), noteHandles: new Map(handles.noteHandles) });
export function buildTidyRequest(payload) {
  return { model: CLAUDE_MODEL, max_tokens: PROPOSAL_MAX_TOKENS, output_config: { effort: PROPOSAL_EFFORT, format: { type: "json_schema", schema: TIDY_SCHEMA } }, system: payload.system, messages: [{ role: "user", content: payload.requestText }] };
}
export function shape(value, schema) {
  if (schema.anyOf) return schema.anyOf.some((item) => shape(value, item));
  if (schema.type === "null") return value === null;
  if (schema.type === "string") return typeof value === "string" && (!schema.enum || schema.enum.includes(value));
  if (schema.type === "array") return Array.isArray(value) && value.every((item) => shape(item, schema.items));
  return value !== null && typeof value === "object" && !Array.isArray(value) && schema.required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => Object.hasOwn(schema.properties, key) && shape(value[key], schema.properties[key]));
}
export function validateTidyProposal(raw, payload, handles = handleMaps(payload.handles)) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    if (!shape(value, TIDY_SCHEMA)) throw new Error();
    if (value.title !== null) { value.title = validateTitle(value.title); if (value.title === payload.note.title) value.title = null; }
    if (value.tags !== null) {
      value.tags = value.tags.map((tag) => tag.trim());
      if (value.tags.length > 50 || value.tags.some((tag) => !isSafeId(tag)) || new Set(value.tags).size !== value.tags.length) throw new Error();
      if (JSON.stringify([...value.tags].sort()) === JSON.stringify([...payload.note.tags].sort())) value.tags = null;
    }
    const folder = validateFolder(value.folder, payload.note, payload.folders);
    value.folder = folder;
    value.report = [];
    const currentHtml = normalizeBody(payload.note.html);
    if (value.html !== null) {
      const clean = fromClaudeHtml(value.html, handles); value.html = clean.html; value.report = clean.report;
      if (value.html === currentHtml) value.html = null;
    }
    value.changes = diffNoteBodies(currentHtml, value.html ?? currentHtml);
    value.noChanges = value.title === null && value.tags === null && folder.action === "keep" && !value.changes.some((item) => item.id);
    return deepFreeze(value);
  } catch { throw new Error(RESPONSE_ERRORS.invalid); }
}
export function tidyPlan(payload, proposal, ticked, title = proposal.title) {
  const selected = ticked instanceof Set ? ticked : new Set(ticked), patch = {}, createFolders = [], folderChecks = [];
  // The source folder is part of the reviewed context, even when it is kept.
  const original = payload.folders.find((folder) => folder.id === payload.note.folderId);
  if (original) folderChecks.push(original);
  if (selected.has("title") && proposal.title !== null) patch.title = validateTitle(title);
  if (selected.has("tags") && proposal.tags !== null) patch.tags = proposal.tags;
  const folder = proposal.folder;
  if (folder.action === "existing" && !folderChecks.some((item) => item.id === folder.id)) folderChecks.push({ id: folder.id, name: folder.name });
  if (selected.has("folder")) {
    if (folder.action === "create") { createFolders.push({ name: folder.name }); patch.folderId = { create: folder.name }; }
    if (folder.action === "existing") patch.folderId = folder.id;
    if (folder.action === "none") patch.folderId = null;
  }
  if (proposal.changes.some((run) => run.id && selected.has(run.id))) patch.html = assembleBody(payload.note.html, proposal.changes, selected);
  return { generation: payload.generation, notes: [{ id: payload.note.id, expectedRev: payload.note.rev, patch }], createFolders, folderChecks };
}
export const tidyItemIds = (proposal) => [proposal.title !== null && "title", proposal.tags !== null && "tags", proposal.folder.action !== "keep" && "folder", ...proposal.changes.map((run) => run.id)].filter(Boolean);
export const runTidy = (options) => runProposal({ ...options, buildRequest: buildTidyRequest, validate: validateTidyProposal });
export async function runProposal({ payload, buildRequest, validate, session = claudeSession, access = notebookAccess, fetch, maxRetries }) {
  if (!payload) return;
  const request = session.beginRequest(payload.kind);
  if (!request) return;
  const { token, signal } = request;
  let state = { id: session.getSnapshot().proposal?.id ?? token.id, kind: payload.kind, payload, handles: payload.handles, startedAt: new Date().toISOString(), status: "running", proposal: null, changes: [], error: null, cost: { kind: "unknown" }, model: null };
  const update = (patch) => { state = { ...state, ...patch }; session.setProposal(token, state); };
  update({});
  try {
    // Edits keep the disclosed snapshot; deletion or replacement requires another review.
    if (!(await payloadIsLive(payload))) { update({ status: "failed", error: DISCLOSURE_CHANGED }); return; }
    if (!session.isCurrent(token)) return;
    const response = await streamMessage(buildRequest(payload), { fetch, maxRetries, signal, onEvent(event) {
      if (event.type !== "message_start" || !session.isCurrent(token)) return;
      const { usage, model } = event.message;
      const dollars = priceUsage(model, { input_tokens: usage.input_tokens, cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0, output_tokens: 0 });
      update({ model, cost: dollars === null ? { kind: "unknown" } : { kind: "at-least", dollars } });
    } });
    if (!session.isCurrent(token)) return;
    if (response.stop_reason === "refusal") { update({ status: "failed", error: RESPONSE_ERRORS.refusal, cost: { kind: "unknown" }, model: response.model }); return; }
    const dollars = priceUsage(response.model, response.usage);
    update({ cost: dollars === null ? { kind: "unknown" } : { kind: "known", dollars }, model: response.model,
      fallback: response.usage?.iterations?.some((item) => item.type === "fallback_message") || response.content.some((item) => item.type === "fallback") });
    if (dollars !== null && session.isCurrent(token) && canStartClaudeRequest(access.getSnapshot())) await addClaudeSpend(response.id, dollars).catch(() => {});
    if (!session.isCurrent(token)) return;
    if (response.stop_reason === "max_tokens") { update({ status: "failed", error: RESPONSE_ERRORS.truncated }); return; }
    try {
      if (response.stop_reason !== "end_turn") throw new Error();
      const proposal = validate(response.content.filter((block) => block.type === "text").at(-1)?.text, payload);
      update({ status: "ready", proposal, changes: proposal.changes });
    } catch { update({ status: "failed", error: RESPONSE_ERRORS.invalid }); }
  } catch (error) { update({ status: "failed", error: toClaudeError(error).message }); }
  finally { session.endRequest(token); }
}
