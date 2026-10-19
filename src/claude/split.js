import { Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { newId } from "../lib/ids.js";
import { htmlToText } from "../lib/text.js";
import { noteTitle } from "../lib/notebookView.js";
import { captureTidyPayload, folderSchema, nullableString, shape, validateTitle, validateFolder, handleMaps, runProposal } from "./proposals.js";
import { validateTags, hasBody } from "./merge.js";
import { deepFreeze } from "./payload.js";
import { noteSchema, parseBody, fromClaudeHtml, serializeBody, withTrailingParagraph } from "./html.js";
import { appendLinkLine } from "./links.js";
import { lineChanges, effects, markCounts } from "./diff.js";
import { SPLIT_SYSTEM_PROMPT } from "./prompts.js";
import { CLAUDE_MODEL, PROPOSAL_EFFORT, PROPOSAL_MAX_TOKENS } from "./config.js";
import { RESPONSE_ERRORS } from "./client.js";

export const SPLIT_TASK = "Split this note into separate notes.";
export const DEFAULT_SPLIT_INSTRUCTION = "Split this note into separate notes by topic.";
const noteProperties = { title: { type: "string" }, html: { type: "string" }, folder: folderSchema, tags: { type: "array", items: { type: "string" } }, reason: { type: "string" } };
const properties = { summary: { type: "string" }, title: nullableString, html: { type: "string" }, notes: { type: "array", items: { type: "object", properties: noteProperties, required: Object.keys(noteProperties), additionalProperties: false } } };
export const SPLIT_SCHEMA = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
export async function captureSplitPayload(noteId, instruction = "") {
  const captured = await captureTidyPayload(noteId, instruction);
  const { notebookData } = JSON.parse(captured.requestText);
  return deepFreeze({ ...captured, kind: "split", requestText: JSON.stringify({ task: SPLIT_TASK, instruction: captured.instruction || DEFAULT_SPLIT_INSTRUCTION, notebookData }), system: SPLIT_SYSTEM_PROMPT });
}
export function validateSplitProposal(raw, payload) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    if (!shape(value, SPLIT_SCHEMA) || value.notes.length > 10) throw new Error();
    if (!value.notes.length) return deepFreeze({ ...value, noChanges: true, summary: "Claude suggests no split." });
    if (value.title !== null) { value.title = validateTitle(value.title); if (value.title === payload.note.title) value.title = null; }
    const handles = handleMaps(payload.handles), names = new Map();
    value.remaining = fromClaudeHtml(value.html, handles).html;
    value.notes = value.notes.map((note) => {
      note.title = validateTitle(note.title); note.tags = validateTags(note.tags);
      note.folder = validateFolder(note.folder, payload.note, payload.folders);
      if (note.folder.action === "create") {
        const key = note.folder.name.toLowerCase();
        if (!names.has(key)) names.set(key, note.folder.name);
        note.folder.name = names.get(key);
      }
      note.html = fromClaudeHtml(note.html, handles).html;
      if (!hasBody(note.html)) throw new Error();
      return note;
    });
    const title = value.title ?? payload.note.title;
    const after = [{ title: title || noteTitle({ title: "", text: htmlToText(value.remaining) }), html: value.remaining }, ...value.notes.map((note) => ({ title: note.title || noteTitle({ title: "", text: htmlToText(note.html) }), html: note.html }))];
    value.lines = lineChanges([{ title: noteTitle({ ...payload.note, text: htmlToText(payload.note.html) }), html: payload.note.html }], after);
    value.effects = effects([payload.note.html], after.map((note) => note.html));
    const beforeMarks = markCounts(payload.note.html), afterMarks = {};
    for (const note of after) for (const [mark, count] of Object.entries(markCounts(note.html))) afterMarks[mark] = (afterMarks[mark] ?? 0) + count;
    value.formatting = [...new Set([...Object.keys(beforeMarks), ...Object.keys(afterMarks)])].filter((mark) => (beforeMarks[mark] ?? 0) !== (afterMarks[mark] ?? 0))
      .map((mark) => ({ mark, before: beforeMarks[mark] ?? 0, after: afterMarks[mark] ?? 0 }));
    value.noChanges = false;
    return deepFreeze(value);
  } catch { throw new Error(RESPONSE_ERRORS.invalid); }
}
export function splitPlan(payload, proposal) {
  const folderChecks = new Map(), creates = new Set();
  const original = payload.folders.find((folder) => folder.id === payload.note.folderId);
  if (original) folderChecks.set(original.id, original);
  const createNotes = proposal.notes.map((note) => {
    const folder = note.folder;
    if (folder.action === "existing") folderChecks.set(folder.id, { id: folder.id, name: folder.name });
    if (folder.action === "create") creates.add(folder.name);
    return { id: newId(), title: note.title, html: note.html, tags: note.tags,
      folderId: folder.action === "keep" ? payload.note.folderId : folder.action === "existing" ? folder.id : folder.action === "create" ? { create: folder.name } : null };
  });
  const tr = new Transform(Node.fromJSON(noteSchema, parseBody(proposal.remaining)));
  appendLinkLine(tr, "Split into:", createNotes.map((note) => ({ id: note.id, text: noteTitle({ ...note, text: htmlToText(note.html) }) })));
  return { kind: "split", generation: payload.generation, createNotes, createFolders: [...creates].map((name) => ({ name })), expectedNewFolders: [...creates], folderChecks: [...folderChecks.values()],
    notes: [{ id: payload.note.id, expectedRev: payload.note.rev, role: "content", patch: { html: serializeBody(withTrailingParagraph(tr.doc.toJSON())), ...(proposal.title !== null ? { title: proposal.title } : {}) } }] };
}
export function buildSplitRequest(payload) {
  return { model: CLAUDE_MODEL, max_tokens: PROPOSAL_MAX_TOKENS, output_config: { effort: PROPOSAL_EFFORT, format: { type: "json_schema", schema: SPLIT_SCHEMA } }, system: payload.system, messages: [{ role: "user", content: payload.requestText }] };
}
export const runSplit = (options) => runProposal({ ...options, buildRequest: buildSplitRequest, validate: validateSplitProposal });
