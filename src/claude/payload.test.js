import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db, notebookAccess } from "../db/db.js";
import { resetDatabase, noteFixture } from "../test/fixtures.js";
import { importBackup } from "../db/backup.js";
import { updateNote } from "../db/notes.js";
import { captureNotebookPayload, captureNotePayload, buildDocuments, prepareNoteImages, estimateRequest, imageTokens, payloadIsLive, CITED_TOKENS_PER_CHAR, PLAIN_TOKENS_PER_CHAR } from "./payload.js";
import { ASK_SYSTEM_PROMPT } from "./prompts.js";
import { notebookAnswer, followupAnswer, noteAnswer, cutAnswer, fallbackAnswer } from "./fixtures/ask.js";
import { processImage } from "../lib/images.js";
vi.mock("../lib/images.js", () => ({ processImage: vi.fn() }));
beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
const seed = async (overrides = {}) => { const note = noteFixture(overrides); await db.notes.put(note); return note; };
it("captures only live notes in stable createdAt/id order, metadata and generation, deeply frozen", async () => {
  await db.folders.put({ id: "folder", name: "Español", position: 0 });
  await seed({ id: "z", title: "z", tags: ["a", "b"], folderId: "folder", pinned: true });
  await seed({ id: "a", title: "a".repeat(110) });
  await seed({ id: "trash", deletedAt: "2026-10-18", html: "<p>PRIVATE TRASH</p>" });
  const capture = await captureNotebookPayload();
  expect(capture.entries.map((entry) => entry.noteId)).toEqual(["a", "z"]);
  expect(capture.entries[0].title).toHaveLength(100);
  expect(capture.entries[1].context).toBe("Folder: Español · Tags: a, b · Created 16 Oct 2026 · Edited 16 Oct 2026 · Pinned");
  expect(capture.entries[0].context).toContain("No folder · Tags: none");
  expect(Object.isFrozen(capture.entries[0])).toBe(true);
  expect(() => { capture.entries[0].text = "changed"; }).toThrow();
  expect(buildDocuments(capture)).toEqual(buildDocuments(await captureNotebookPayload()));
  expect(JSON.stringify(capture)).not.toContain("PRIVATE TRASH");
  await updateNote("a", { html: "<p>Later change</p>" });
  expect(buildDocuments(capture)[0].source.data).toBe("Hello");
});
it("captures in read-only mode but refuses a changed generation", async () => {
  await seed();
  vi.spyOn(notebookAccess, "getSnapshot").mockReturnValue({ readOnly: true });
  expect((await captureNotebookPayload()).entries).toHaveLength(1);
  await db.prefs.put({ key: "notebookGeneration", value: "replaced" });
  await expect(captureNotebookPayload()).rejects.toThrow("replaced");
});
it("does not read image bytes until requested, deduplicates in document order and checks revision", async () => {
  const note = await seed({ html: '<img data-file="b"><img data-file="a"><img data-file="b">' });
  for (const id of ["a", "b"]) { await db.files.put({ id, type: "image/png", width: 20, height: 30, size: 3 }); await db.fileData.put({ id, bytes: new Uint8Array([1,2,3]).buffer }); }
  const bytes = vi.spyOn(db.fileData, "bulkGet");
  const payload = await captureNotePayload(note.id);
  expect(bytes).not.toHaveBeenCalled(); expect(payload.images.map((image) => image.fileId)).toEqual(["b", "a"]);
  const result = await prepareNoteImages(payload);
  expect(result).toEqual({ images: [{ type: "image/png", data: "AQID", width: 20, height: 30 }, { type: "image/png", data: "AQID", width: 20, height: 30 }], omitted: [], sentBytes: 8 });
  expect(Object.isFrozen(result.images[0])).toBe(true); expect(processImage).not.toHaveBeenCalled();
  await updateNote(note.id, { pinned: true });
  expect(await prepareNoteImages(payload)).toEqual({ stale: true });
});
it("makes request-only resized copies, lists failures and images past 20, and never writes originals", async () => {
  const ids = Array.from({ length: 22 }, (_, i) => `image-${i}`);
  const note = await seed({ html: ids.map((id) => `<img data-file="${id}">`).join("") });
  for (const [i, id] of ids.entries()) {
    await db.files.put({ id, type: "image/png", width: i === 0 ? 9000 : 40, height: 60, size: i === 1 ? 4_000_000 : 3 });
    if (i !== 2) await db.fileData.put({ id, bytes: new Uint8Array(i === 1 ? 4_000_000 : [1,2,3]).buffer });
  }
  processImage.mockResolvedValue({ type: "image/webp", bytes: new Uint8Array([4,5,6]).buffer, width: 2560, height: 18 });
  const originals = await db.fileData.toArray();
  const result = await prepareNoteImages(await captureNotePayload(note.id));
  expect(processImage).toHaveBeenCalledTimes(2); expect(result.images).toHaveLength(19);
  expect(result.images[0]).toEqual({ type: "image/webp", data: "BAUG", width: 2560, height: 18 });
  expect(result.omitted.map((image) => image.fileId)).toEqual(["image-2", "image-20", "image-21"]);
  expect(await db.fileData.toArray()).toEqual(originals);
});
it("omits an image if shrinking fails or the copy is still too big", async () => {
  const note = await seed({ html: '<img data-file="large">' });
  await db.files.put({ id: "large", type: "image/png", width: 9000, height: 60, size: 3 });
  await db.fileData.put({ id: "large", bytes: new Uint8Array([1,2,3]).buffer });
  const payload = await captureNotePayload(note.id);
  processImage.mockRejectedValueOnce(new Error("bad"));
  expect((await prepareNoteImages(payload)).omitted).toHaveLength(1);
  processImage.mockResolvedValueOnce({ type: "image/png", width: 2560, height: 2560, bytes: new Uint8Array(4_000_000).buffer });
  expect((await prepareNoteImages(payload)).images).toEqual([]);
});
it("uses valid empty document text and prices first, warm and expired follow-ups and sent image dimensions", async () => {
  await seed({ html: "<p></p>" }); const payload = await captureNotebookPayload();
  expect(buildDocuments(payload)[0].source.data).toBe("(empty note)");
  const now = "2026-10-18T12:00:00Z", question = "Hola";
  const docs = buildDocuments(payload);
  const asked = Math.ceil(question.length * PLAIN_TOKENS_PER_CHAR);
  const base = Math.ceil((ASK_SYSTEM_PROMPT.length + docs.reduce((n,d) => n+d.title.length+d.context.length+d.source.data.length,0)) * CITED_TOKENS_PER_CHAR) + asked;
  const first = estimateRequest({ payload, question, now });
  expect(first.tokens).toBe(base);
  expect(first.dollars).toBeCloseTo(base * (base >= 512 ? 5 : 4) / 1e6 + .02); // 1,000 output tokens at $20/M
  const history = [{ status: "completed", startedAt: now, usage: { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 200 } }];
  const warm = estimateRequest({ payload, question, history, now: "2026-10-18T12:04:59Z" });
  // Reported counts replace the character estimate.
  expect(warm.tokens).toBe(1300 + asked); expect(warm.dollars).toBeCloseTo(warm.tokens * .2 / 1e6 + .02);
  const cold = estimateRequest({ payload, question, history, now: "2026-10-18T12:05:00Z" });
  expect(cold.dollars).toBeCloseTo(cold.tokens * 5 / 1e6 + .02);
  const withImage = estimateRequest({ payload, question, images: { images: [{ width: 1180, height: 2560 }] } });
  expect(withImage.tokens - first.tokens).toBe(imageTokens({ width: 1180, height: 2560 }));
  expect(imageTokens({ width: 10000, height: 10000 })).toBe(4784);
  expect(estimateRequest({ payload: { entries: [{ text: "a".repeat(400000), title: "", context: "" }] } }).tokens).toBeGreaterThan(100000);
});
it("checks live notes, Trash, purges and generations before reusing a payload", async () => {
  const note = await seed(); const payload = await captureNotebookPayload();
  expect(await payloadIsLive(payload)).toBe(true);
  await db.notes.update(note.id, { deletedAt: "2026-10-18" }); expect(await payloadIsLive(payload)).toBe(false);
  await db.notes.delete(note.id); expect(await payloadIsLive(payload)).toBe(false);
  await seed(); notebookAccess.adopt("new"); expect(await payloadIsLive(payload)).toBe(false);
});
it("all fixture citations match the imported sample notebook's stable live order", async () => {
  const sample = JSON.parse(readFileSync(resolve(__dirname, '../../public/sample-notebook.json'), 'utf8'));
  await importBackup(sample); const payload = await captureNotebookPayload();
  for (const fixture of [notebookAnswer, followupAnswer, cutAnswer, fallbackAnswer]) for (const event of fixture) {
    const citation = event.delta?.citation;
    if (citation) {
      expect(payload.entries[citation.document_index].title).toBe(citation.document_title);
      expect(payload.entries[citation.document_index].text.slice(citation.start_char_index, citation.end_char_index)).toBe(citation.cited_text);
    }
  }
  const note = sample.notes.find((note) => note.title === "Captura de ejemplo");
  const single = await captureNotePayload(note.id);
  for (const event of noteAnswer) if (event.delta?.citation) expect(single.entries[event.delta.citation.document_index].title).toBe(event.delta.citation.document_title);
});
