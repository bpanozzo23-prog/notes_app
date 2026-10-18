import { db, notebookAccess, NotebookReplacedError, DATABASE_UPDATED } from "../db/db.js";
import { noteTitle } from "../lib/notebookView.js";
import { extractFileIds } from "../lib/text.js";
import { processImage } from "../lib/images.js";
import { toBase64 } from "../lib/base64.js";
import { noteToClaudeText } from "./projection.js";
import { ASK_SYSTEM_PROMPT } from "./prompts.js";
import { CLAUDE_MODEL, priceUsage } from "./config.js";

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}
// Read-only capture is permitted. Never read all preferences (in particular, the key).
export async function checkGeneration(expected = notebookAccess.getGeneration()) {
  const access = notebookAccess.getSnapshot();
  if (access.replaced || expected !== notebookAccess.getGeneration()) throw new NotebookReplacedError();
  if (access.versionChange === "closed") throw new Error(DATABASE_UPDATED);
  if (expected === undefined) throw new Error("The notebook has not been opened.");
  if (((await db.prefs.get("notebookGeneration"))?.value ?? null) !== expected) throw new NotebookReplacedError();
  return expected;
}
const date = (value) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
async function capture(scope) {
  return db.transaction("r", db.notes, db.folders, db.files, db.prefs, async () => {
    const generation = await checkGeneration();
    const [notes, folders] = await Promise.all([db.notes.filter((note) => note.deletedAt === null).toArray(), db.folders.toArray()]);
    const lookup = new Map(notes.map((note) => [note.id, note]));
    const selected = scope.kind === "note" ? notes.filter((note) => note.id === scope.noteId) : notes;
    if (scope.kind === "note" && !selected.length) throw new Error("That note no longer exists or is in Trash.");
    selected.sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const entries = selected.map((note) => ({ noteId: note.id, rev: note.rev, updatedAt: note.updatedAt,
      title: noteTitle(note).slice(0, 100),
      context: `Folder: ${folders.find((folder) => folder.id === note.folderId)?.name ?? "No folder"} · Tags: ${note.tags.join(", ") || "none"} · Created ${date(note.createdAt)} · Edited ${date(note.updatedAt)}${note.pinned ? " · Pinned" : ""}`,
      text: noteToClaudeText(note.html, lookup),
    }));
    const images = [];
    if (scope.kind === "note") for (const fileId of extractFileIds(selected[0].html)) {
      const file = await db.files.get(fileId);
      // Retain missing references too, so the disclosure can list omissions.
      const { type, width, height, size } = file ?? {};
      images.push({ fileId, type, width, height, size });
    }
    return deepFreeze({ capturedAt: new Date().toISOString(), generation, scope, entries, ...(scope.kind === "note" ? { images } : {}) });
  });
}
export const captureNotebookPayload = () => capture({ kind: "notebook" });
export const captureNotePayload = (noteId) => capture({ kind: "note", noteId });
export const buildDocuments = (payload) => payload.entries.map(({ title, context, text }) => ({
  type: "document", source: { type: "text", media_type: "text/plain", data: text || "(empty note)" }, title, context, citations: { enabled: true },
}));
export async function payloadIsLive(payload) {
  return db.transaction("r", db.notes, db.prefs, async () => {
    try { await checkGeneration(payload.generation); } catch { return false; }
    const rows = await db.notes.bulkGet(payload.entries.map((entry) => entry.noteId));
    return rows.every((note) => note?.deletedAt === null);
  });
}
export async function prepareNoteImages(payload) {
  const rows = await db.transaction("r", db.notes, db.fileData, db.prefs, async () => {
    await checkGeneration(payload.generation);
    const note = await db.notes.get(payload.scope.noteId);
    if (note?.deletedAt !== null || note.rev !== payload.entries[0]?.rev) return null;
    return db.fileData.bulkGet((payload.images ?? []).slice(0, 20).map((image) => image.fileId));
  });
  if (!rows) return { stale: true };
  const images = [], omitted = [];
  let sentBytes = 0;
  for (const [index, metadata] of (payload.images ?? []).entries()) {
    const { fileId } = metadata;
    if (index >= 20) { omitted.push({ fileId, reason: "Only the first 20 images can be sent." }); continue; }
    try {
      if (!rows[index]?.bytes || !metadata.type) throw new Error();
      let image = { ...metadata, bytes: rows[index].bytes };
      if (Math.max(image.width, image.height) > 2576 || 4 * Math.ceil(image.bytes.byteLength / 3) > 5_000_000) {
        image = await processImage(new Blob([image.bytes], { type: image.type }));
      }
      const data = toBase64(image.bytes);
      if (data.length > 5_000_000 || Math.max(image.width, image.height) > 2576) throw new Error();
      images.push({ type: image.type, data, width: image.width, height: image.height }); sentBytes += data.length;
    } catch { omitted.push({ fileId, reason: "This image couldn't be prepared." }); }
  }
  return deepFreeze({ images, omitted, sentBytes });
}
export const imageTokens = ({ width, height }) => Math.min(4784, Math.ceil(width / 28) * Math.ceil(height / 28));
// Tokens per character, measured with real requests on the sample notebook (2026-10-18,
// scripts/claude-check.mjs): citation-enabled documents cost far more than plain text (Anthropic
// adds instructions and splits the text into citable sentences): 9,685 tokens for 11,800
// characters. A tidy request (HTML inside JSON) measured 2,301 tokens for 3,640 characters.
// Claude's replies at these efforts: about 600–700 tokens including its hidden thinking.
export const CITED_TOKENS_PER_CHAR = 0.85;
export const PLAIN_TOKENS_PER_CHAR = 0.65;
const QUESTION_OUTPUT_ALLOWANCE = 1000;
export function estimateRequest({ kind = "question", payload, images, history = [], question = "", now = new Date() }) {
  if (kind === "tidy") {
    const tokens = Math.ceil((payload.requestText.length + payload.system.length) * PLAIN_TOKENS_PER_CHAR);
    // The whole note comes back, plus thinking at high effort.
    const output = Math.ceil(payload.claudeHtml.length * PLAIN_TOKENS_PER_CHAR * 1.5) + 800;
    return { tokens, dollars: priceUsage(CLAUDE_MODEL, { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output }) };
  }
  const documents = buildDocuments(payload);
  const base = Math.ceil((ASK_SYSTEM_PROMPT.length + documents.reduce((sum, doc) => sum + doc.title.length + doc.context.length + doc.source.data.length, 0)) * CITED_TOKENS_PER_CHAR);
  const previous = history.filter((turn) => turn.status === "completed").at(-1);
  const earlier = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce((sum, key) => sum + (previous?.usage?.[key] ?? 0), 0);
  // A follow-up resends everything the previous request read and wrote; its reported counts
  // already include the instructions, notes and images, so they replace the character estimate.
  const tokens = (previous ? earlier : base + (images?.images ?? images ?? []).reduce((sum, image) => sum + imageTokens(image), 0)) + Math.ceil(question.length * PLAIN_TOKENS_PER_CHAR);
  const elapsed = previous ? +new Date(now) - +new Date(previous.startedAt) : Infinity;
  const cached = previous && elapsed >= 0 && elapsed < 300000;
  const output = ["proposal", "notebook-proposal"].includes(kind) ? 6000 : QUESTION_OUTPUT_ALLOWANCE;
  const dollars = priceUsage(CLAUDE_MODEL, { input_tokens: tokens < 512 ? tokens : 0,
    cache_creation_input_tokens: tokens >= 512 && !cached ? tokens : 0, cache_read_input_tokens: tokens >= 512 && cached ? tokens : 0, output_tokens: output });
  return { tokens, dollars };
}
