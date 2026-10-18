import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, notebookAccess } from "./db.js";
import { addImageFile, cleanupFiles, getFile, fileStats, FILE_RETENTION_MS, MAX_IMAGE_BYTES } from "./files.js";
import { buildBackup, importBackup, upgradeEnvelope, validateBackup } from "./backup.js";
import { createNote, updateNote, trashNote, restoreNote } from "./notes.js";
import { acquire, release, clearFileUrls } from "../editor/fileUrls.js";
import { toBase64, fromBase64 } from "../lib/base64.js";
import { jsonBlob, readFileAsText } from "../lib/file.js";
import { AT, backupFixture, noteFixture, resetDatabase } from "../test/fixtures.js";

const image = () => ({ type: "image/png", bytes: new Uint8Array([1, 2, 3, 254, 255]).buffer, width: 480, height: 270 });
const file = (overrides = {}) => ({ id: "image", type: "image/png", size: 5, width: 480, height: 270, createdAt: AT, data: toBase64(image().bytes), ...overrides });
const envelope = (files = [file()], notes = [noteFixture({ html: '<img data-file="image" width="480" height="270">' })]) => backupFixture({ schemaVersion: 4, files, notes });
const at = (days) => new Date(Date.parse(AT) + days * FILE_RETENTION_MS / 30);
beforeEach(resetDatabase);
afterEach(() => { clearFileUrls(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("writes immutable bytes and metadata with a guarded id, reads and counts files", async () => {
  const id = await addImageFile(image());
  const { bytes, ...metadata } = image();
  expect(await getFile(id)).toEqual({ ...metadata, id, size: 5, unusedSince: null, createdAt: expect.any(String) });
  expect(await db.fileData.get(id)).toEqual({ id, bytes });
  expect(await fileStats()).toEqual({ count: 1, bytes: 5, base64Bytes: 8 });
  notebookAccess.adopt("stale");
  await expect(addImageFile(image())).rejects.toThrow("replaced");
});
it("rolls back metadata if adding image bytes fails", async () => {
  vi.spyOn(db.fileData, "add").mockRejectedValueOnce(new Error("Disk full"));
  await expect(addImageFile(image())).rejects.toThrow("Disk full");
  expect(await db.files.count()).toBe(0); expect(await db.fileData.count()).toBe(0);
});
it("marks unused images, preserves bytes and deletes only after more than 30 unused days", async () => {
  const id = await addImageFile(image());
  const before = await getFile(id);
  const beforeData = await db.fileData.get(id);
  await cleanupFiles(at(0));
  expect(await getFile(id)).toEqual({ ...before, unusedSince: AT });
  expect(await db.fileData.get(id)).toEqual(beforeData);
  await cleanupFiles(at(30)); expect(await getFile(id)).toBeDefined();
  expect(await db.fileData.get(id)).toEqual(beforeData);
  await cleanupFiles(new Date(at(30).getTime() + 1)); expect(await getFile(id)).toBeUndefined();
  expect(await db.fileData.get(id)).toBeUndefined();
});
it("cleanup and statistics never read image bytes and only update changed metadata", async () => {
  const fresh = await addImageFile(image()), reused = await addImageFile(image()), expired = await addImageFile(image());
  const live = await addImageFile(image()), marked = await addImageFile(image());
  await db.files.update(reused, { unusedSince: AT });
  await db.files.update(expired, { unusedSince: AT });
  await db.files.update(marked, { unusedSince: at(1).toISOString() });
  await createNote({ html: `<img data-file="${reused}"><img data-file="${live}">` });
  await db.files.update(reused, { unusedSince: AT }); // Exercise cleanup's own stale-mark repair.
  const read = vi.fn((row) => row), update = vi.spyOn(db.files, "update");
  db.fileData.hook("reading", read);
  try {
    await cleanupFiles(at(31));
    expect(await fileStats()).toEqual({ count: 4, bytes: 20, base64Bytes: 32 });
    expect(read).not.toHaveBeenCalled();
    expect(update.mock.calls).toEqual([[reused, { unusedSince: null }], [fresh, { unusedSince: at(31).toISOString() }]]);
  } finally { db.fileData.hook("reading").unsubscribe(read); }
  expect(await db.fileData.get(expired)).toBeUndefined();
  for (const id of [fresh, reused, live, marked]) expect(await db.fileData.get(id)).toEqual({ id, bytes: image().bytes });
  expect((await getFile(marked)).unusedSince).toBe(at(1).toISOString());
});
it("rolls back both tables and new marks if cleanup cannot delete image bytes", async () => {
  const expired = await addImageFile(image());
  await db.files.update(expired, { unusedSince: AT });
  await addImageFile(image());
  const metadata = await db.files.toArray(), data = await db.fileData.toArray();
  vi.spyOn(db.fileData, "bulkDelete").mockRejectedValueOnce(new Error("Delete failed"));
  await expect(cleanupFiles(at(31))).rejects.toThrow("Delete failed");
  expect(await db.files.toArray()).toEqual(metadata); expect(await db.fileData.toArray()).toEqual(data);
});
it("keeps Trash images, clears a mark on reuse, and restarts the clock when unused again", async () => {
  const id = await addImageFile(image());
  await cleanupFiles(at(0));
  const note = await createNote({ html: `<img data-file="${id}">` });
  await trashNote(note.id); await cleanupFiles(at(40));
  expect((await getFile(id)).unusedSince).toBeNull();
  await db.notes.delete(note.id); await cleanupFiles(at(41));
  expect((await getFile(id)).unusedSince).toBe(at(41).toISOString());
});
it("delete in A, startup in B, Undo in A and another startup keep the image", async () => {
  const id = await addImageFile(image()), html = `<img data-file="${id}">`;
  const note = await createNote({ html });
  await updateNote(note.id, { html: "<p></p>" });
  await cleanupFiles(at(0));
  expect((await getFile(id)).unusedSince).toBe(AT);
  await updateNote(note.id, { html }); await cleanupFiles(at(1));
  expect((await getFile(id)).unusedSince).toBeNull();
});
it("cut from A and paste to B keeps the shared file", async () => {
  const id = await addImageFile(image()), html = `<img data-file="${id}">`;
  const a = await createNote({ html }), b = await createNote();
  await updateNote(a.id, { html: "<p></p>" }); await cleanupFiles(at(0));
  await updateNote(b.id, { html }); await cleanupFiles(at(31));
  expect((await getFile(id)).unusedSince).toBeNull();
});
it.each(["create", "update", "restore"])("%s clears reused image marks without reading bytes; a later removal gets a fresh clock", async (operation) => {
  const id = await addImageFile(image()), live = await addImageFile(image());
  const html = `<img data-file="${id}"><img data-file="${live}"><img data-file="missing">`;
  let note = await createNote({ html: operation === "restore" ? html : "<p></p>" });
  if (operation === "restore") await trashNote(note.id);
  await cleanupFiles(at(0));
  // Restore can encounter a stale mark from another window/older build.
  await db.files.update(id, { unusedSince: AT });
  await db.files.update(live, { unusedSince: null });
  const read = vi.fn((row) => row), update = vi.spyOn(db.files, "update");
  db.fileData.hook("reading", read);
  try {
    if (operation === "create") note = await createNote({ html });
    if (operation === "update") await updateNote(note.id, { html });
    if (operation === "restore") await restoreNote(note.id);
    expect(read).not.toHaveBeenCalled();
    expect(update.mock.calls).toEqual([[id, { unusedSince: null }]]);
    expect((await getFile(id)).unusedSince).toBeNull();
  } finally { db.fileData.hook("reading").unsubscribe(read); }
  await updateNote(note.id, { html: "<p></p>" });
  await cleanupFiles(at(31));
  expect((await getFile(id))?.unusedSince).toBe(at(31).toISOString());
  expect(await db.fileData.get(id)).toEqual({ id, bytes: image().bytes });
});
it.each(["create", "update", "restore"])("%s rolls back note and metadata together if clearing a mark fails", async (operation) => {
  const id = await addImageFile(image()), html = `<img data-file="${id}">`;
  const note = await createNote({ html });
  await trashNote(note.id);
  await db.files.update(id, { unusedSince: AT });
  const before = await db.notes.toArray();
  vi.spyOn(db.files, "update").mockRejectedValueOnce(new Error("Storage full"));
  const save = operation === "create" ? () => createNote({ html }) : operation === "update"
    ? () => updateNote(note.id, { html }) : () => restoreNote(note.id);
  await expect(save()).rejects.toThrow("Storage full");
  expect(await db.notes.toArray()).toEqual(before);
  expect((await getFile(id)).unusedSince).toBe(AT);
});
it("skips cleanup in read-only mode and rolls back failed cleanup", async () => {
  const id = await addImageFile(image());
  const spy = vi.spyOn(notebookAccess, "getSnapshot").mockReturnValue({ readOnly: true });
  await cleanupFiles(at(0)); expect((await getFile(id)).unusedSince).toBeNull();
  spy.mockRestore();
  vi.spyOn(db.notes, "toArray").mockRejectedValueOnce(new Error("Read failed"));
  await expect(cleanupFiles()).rejects.toThrow("Read failed");
  expect((await getFile(id)).unusedSince).toBeNull();
});
it("round trips identical bytes separately from metadata and derives references from HTML", async () => {
  const id = await addImageFile(image());
  await addImageFile(image()); // Unreferenced file is not exported.
  const note = await createNote({ html: `<img data-file="${id}">` });
  await db.notes.update(note.id, { fileIds: ["stale"] });
  await trashNote(note.id);
  const readData = vi.spyOn(db.fileData, "get"), readMetadata = vi.spyOn(db.files, "get");
  const raw = await buildBackup();
  expect(readData.mock.calls).toEqual([[id]]); expect(readMetadata.mock.calls).toEqual([[id]]);
  expect(raw.files).toHaveLength(1);
  const before = await getFile(id);
  const beforeData = await db.fileData.get(id);
  expect(raw.files[0]).not.toHaveProperty("unusedSince");
  const json = await readFileAsText(jsonBlob(raw));
  expect(JSON.parse(json)).toEqual(raw);
  await importBackup(validateBackup(json).envelope);
  expect(new Uint8Array((await db.fileData.get(id)).bytes)).toEqual(new Uint8Array(beforeData.bytes));
  expect(await getFile(id)).toEqual(before);
  expect(await db.files.count()).toBe(1); expect(await db.fileData.count()).toBe(1);
});
it.each(["files", "fileData"])("exports a missing-image reference and validation warning when %s is missing", async (table) => {
  const id = await addImageFile(image());
  const note = await createNote({ html: `<img data-file="${id}">` });
  await db[table].delete(id);
  const raw = await buildBackup(), result = validateBackup(raw);
  expect(raw.files).toEqual([]); expect(raw.notes[0].html).toBe(note.html);
  expect(result.ok).toBe(true); expect(result.warnings).toEqual([`Note ${note.id} shows a missing image.`]);
  expect(await acquire(id)).toBeNull(); release(id);
});
it.each([1, 2, 3])("upgrades v%s to 4 with no files", (schemaVersion) => {
  expect(upgradeEnvelope(backupFixture({ schemaVersion })).envelope).toMatchObject({ schemaVersion: 4, files: [] });
});
it("shares file objects during upgrade, skips unused files without mutating the input, warns for missing files", () => {
  const raw = envelope([file(), file({ id: "unused" })], [noteFixture({ html: '<img data-file="image"><img data-file="missing">', fileIds: ["unused"] })]);
  const result = validateBackup(raw);
  expect(result.ok).toBe(true); expect(result.warnings).toHaveLength(2);
  expect(result.warnings).toContain(`Note ${noteFixture().id} shows a missing image.`);
  expect(result.envelope.files).toEqual([raw.files[0]]);
  expect(result.envelope.files[0]).toBe(raw.files[0]);
  expect(raw.files).toHaveLength(2);
  expect(upgradeEnvelope(raw).envelope.notes[0]).not.toBe(raw.notes[0]);
});
it.each([
  ["id", ""], ["id", "bad\nid"], ["type", "image/svg+xml"], ["type", null],
  ["data", null], ["data", "a"], ["data", "a==="], ["data", "AA=A"], ["data", "AAAA\n"], ["data", "AB=="], ["data", "AAB="], ["data", "____"],
  ["size", 4], ["size", 0], ["size", -1], ["size", 1.5], ["size", MAX_IMAGE_BYTES + 1],
  ["width", 0], ["width", 10001], ["width", 1.5], ["width", "480"],
  ["height", null], ["height", -1], ["height", 10001], ["height", 1.5],
  ["createdAt", "2026-10-17"], ["createdAt", "2026-10-17T00:00:00+00:00"], ["createdAt", "2026-02-30T00:00:00.000Z"],
])("rejects image %s=%j even if unused", (key, value) => {
  const result = validateBackup(envelope([file({ [key]: value })], []));
  expect(result.ok).toBe(false); expect(result.errors.join(" ")).toContain(key);
});
it.each([null, {}, "files"])("rejects files container %j", (files) => expect(validateBackup(envelope(files)).ok).toBe(false));
it("rejects malformed rows and every cross-table collision", () => {
  expect(validateBackup(envelope([null])).ok).toBe(false);
  expect(validateBackup(envelope([file(), file()])).errors.join(" ")).toContain("Duplicate");
  for (const patch of [{ notes: [noteFixture({ id: "image" })] }, { folders: [{ id: "image", name: "F", position: 0 }] }, { tombstones: [{ id: "image", purgedAt: AT }] }]) {
    expect(validateBackup({ ...envelope(), ...patch }).errors.join(" ")).toContain("Duplicate");
  }
});
it.each(["image/webp", "image/jpeg", "image/png", "image/gif"])("accepts %s and 10,000-pixel backup dimensions", (type) => {
  expect(validateBackup(envelope([file({ type, width: 10000, height: 10000 })])).ok).toBe(true);
});
it.each(["files", "fileData"])("a second %s write failure restores the old notebook and images, generation and URL cache", async (table) => {
  const oldId = await addImageFile(image()), oldNote = await createNote({ html: `<img data-file="${oldId}">` });
  const old = await getFile(oldId);
  const oldData = await db.fileData.get(oldId);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:old"), revokeObjectURL: vi.fn() });
  await acquire(oldId);
  const add = db[table].add.bind(db[table]);
  vi.spyOn(db[table], "add").mockImplementationOnce(add).mockRejectedValueOnce(new Error("Disk full"));
  const raw = envelope([file(), file({ id: "second" })], [noteFixture({ html: '<img data-file="image"><img data-file="second">' })]);
  await expect(importBackup(raw)).rejects.toThrow("Disk full");
  expect(await db.notes.toArray()).toEqual([oldNote]); expect(await db.files.toArray()).toEqual([old]);
  expect(await db.fileData.toArray()).toEqual([oldData]);
  expect(await db.prefs.get("notebookGeneration")).toBeUndefined(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await importBackup(raw); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:old");
  expect((await db.files.toArray()).every((row) => row.unusedSince === null)).toBe(true);
  expect(await db.fileData.toArray()).toEqual(raw.files.map(({ id, data }) => ({ id, bytes: fromBase64(data) })));
});
it("shares URL reads, reference counts views, and does not revive a cleared pending read", async () => {
  const id = await addImageFile(image());
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fixture"), revokeObjectURL: vi.fn() });
  const first = acquire(id), second = acquire(id);
  expect(await first).toBe("blob:fixture"); expect(await second).toBe("blob:fixture");
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  release(id); expect(URL.revokeObjectURL).not.toHaveBeenCalled(); release(id); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  const pending = acquire(id); clearFileUrls(); expect(await pending).toBeNull(); expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(await acquire("missing")).toBeNull(); release("missing");
});
it("chunked base64 handles a large buffer and padding lengths without stack overflow", () => {
  for (const size of [0, 1, 2, 3, 24577, 1024 * 1024 + 1]) {
    const bytes = Uint8Array.from({ length: size }, (_, i) => i % 256);
    const data = toBase64(bytes.buffer);
    expect(data).toBe(Buffer.from(bytes).toString("base64"));
    expect(Buffer.from(fromBase64(data)).equals(Buffer.from(bytes))).toBe(true);
  }
});
