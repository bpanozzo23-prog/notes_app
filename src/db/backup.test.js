import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, allPrefs, setPref } from "./db.js";
import { buildBackup, validateBackup, importBackup, backupFilename, upgradeEnvelope, EXPORTED_PREFS } from "./backup.js";
import { createFolder } from "./folders.js";
import { createNote, updateNote, trashNote } from "./notes.js";
import { AT, backupFixture, noteFixture, resetDatabase } from "../test/fixtures.js";

beforeEach(resetDatabase);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("exports, validates and imports identical rows including trash, tombstones and allowed prefs", async () => {
  const folder = await createFolder("Folder");
  const target = await createNote({ folderId: folder.id, title: "Target" });
  const source = await createNote({ html: `<p><a href="note:${target.id}">Target</a></p>` });
  await updateNote(source.id, { tags: ["one", "two"], pinned: true });
  await trashNote(target.id);
  await db.tombstones.add({ id: "purged", purgedAt: AT });
  await setPref("lastBackupAt", AT);
  await setPref("toolbar", ["bold", "italic"]);
  await setPref("storagePersisted", true);
  await setPref("futureApiKey", "fixture-only-secret");
  const before = await buildBackup();
  expect(Object.keys(before.preferences).sort()).toEqual([...EXPORTED_PREFS].sort());
  expect(JSON.stringify(before)).not.toContain("fixture-only-secret");
  const checked = validateBackup(JSON.stringify(before));
  expect(checked.ok).toBe(true);
  expect(checked.summary).toEqual({ notes: 2, folders: 1, tombstones: 1, trashed: 1, willUpgrade: false });
  await createNote({ title: "To be replaced" });
  await importBackup(checked.envelope);
  const after = await buildBackup();
  for (const key of ["notes", "folders", "tombstones", "preferences"]) expect(after[key]).toEqual(before[key]);
  // Device-local preferences are not in the file and must survive a restore (a Phase 3 API key,
  // this device's storagePersisted answer).
  expect(await allPrefs()).toEqual({ ...before.preferences, futureApiKey: "fixture-only-secret", storagePersisted: true });
});
it("ignores storagePersisted from older backups with a warning instead of restoring it", async () => {
  const checked = validateBackup(backupFixture({ preferences: { storagePersisted: true } }));
  expect(checked.ok).toBe(true);
  expect(checked.warnings.join(" ")).toContain("storagePersisted");
  await importBackup(checked.envelope);
  expect(await allPrefs()).toEqual({});
});
it.each(["a\nb", "x".repeat(513), " ", "bad\u007fid"])("rejects ids the app could not open later: %j", (id) => {
  expect(validateBackup(backupFixture({ notes: [noteFixture({ id })] })).ok).toBe(false);
  expect(validateBackup(backupFixture({ folders: [{ id, name: "F", position: 0 }] })).ok).toBe(false);
});
it("recomputes derived fields from HTML, warns on dangling links, and does not mutate input", async () => {
  const raw = backupFixture({ notes: [noteFixture({ text: "Wrong", linkedIds: ["stale"], html: '<h1>Real</h1><p><a href="note:missing">Target</a></p>' })] });
  const copy = structuredClone(raw);
  const checked = validateBackup(raw);
  expect(checked.ok).toBe(true);
  expect(checked.warnings).toHaveLength(2);
  expect(checked.errors).toEqual([]);
  await importBackup(raw);
  expect(await db.notes.get(raw.notes[0].id)).toMatchObject({ text: "Real\nTarget", linkedIds: ["missing"] });
  expect(raw).toEqual(copy);
});
it("refuses invalid imports before any clears", async () => {
  const note = await createNote({ title: "Keep" });
  const raw = backupFixture({ preferences: { apiKey: "not-allowed" } });
  await expect(importBackup(raw)).rejects.toThrow("Refusing to import");
  expect(await db.notes.toArray()).toEqual([note]);
});
it("rolls back all tables if a write fails after clearing", async () => {
  const folder = await createFolder("Keep folder");
  const note = await createNote({ folderId: folder.id });
  await setPref("storagePersisted", true);
  await db.tombstones.add({ id: "keep-marker", purgedAt: AT });
  vi.spyOn(db.folders, "bulkAdd").mockRejectedValueOnce(new Error("Disk failure"));
  await expect(importBackup(backupFixture())).rejects.toThrow("Disk failure");
  expect(await db.notes.toArray()).toEqual([note]);
  expect(await db.folders.toArray()).toEqual([folder]);
  expect(await db.tombstones.toArray()).toEqual([{ id: "keep-marker", purgedAt: AT }]);
  expect(await allPrefs()).toEqual({ storagePersisted: true });
});
it("names backups to the second in UTC", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AT));
  expect(backupFilename()).toBe("notes-backup-2026-10-16T12-00-00.json");
});

describe("validation failures", () => {
  it.each([null, [], 3, false, "{broken", "null"])("never throws for %j", (raw) => {
    const result = validateBackup(raw);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it.each([
    ["format", "wrong"], ["schemaVersion", undefined], ["schemaVersion", 0], ["schemaVersion", 2],
    ["schemaVersion", 1.5], ["schemaVersion", "1"], ["schemaVersion", NaN],
    ["exportedAt", "yesterday"], ["appVersion", ""],
    ["notes", {}], ["folders", null], ["tombstones", "x"], ["preferences", []], ["preferences", null],
  ])("rejects envelope %s=%j", (key, value) => {
    expect(validateBackup(backupFixture({ [key]: value })).ok).toBe(false);
  });
  it.each([
    ["id", ""], ["title", null], ["html", 12], ["text", undefined], ["folderId", 5],
    ["tags", "tag"], ["tags", [5]], ["tags", [" a"]], ["tags", ["a", "a"]],
    ["linkedIds", null], ["linkedIds", [false]], ["pinned", 1], ["rev", 0], ["rev", 1.2],
    ["createdAt", null], ["updatedAt", "bad"], ["deletedAt", false],
  ])("rejects note %s=%j", (key, value) => {
    const checked = validateBackup(backupFixture({ notes: [noteFixture({ [key]: value })] }));
    expect(checked.ok).toBe(false);
    expect(checked.errors.join(" ")).toContain(key);
  });
  it.each(["notes", "folders", "tombstones"])("rejects non-object and duplicate %s rows", (table) => {
    expect(validateBackup(backupFixture({ [table]: [null] })).ok).toBe(false);
    const row = { notes: noteFixture(), folders: { id: "folder", name: "F", position: 0 }, tombstones: { id: "gone", purgedAt: AT } }[table];
    const result = validateBackup(backupFixture({ [table]: [row, row] }));
    expect(result.errors.join(" ")).toContain("Duplicate id");
  });
  it.each([{ id: "", name: "F", position: 0 }, { id: "f", name: "", position: 0 }, { id: "f", name: "F", position: -1 }, { id: "f", name: "F", position: 0.2 }])("rejects malformed folders %j", (folder) => {
    expect(validateBackup(backupFixture({ folders: [folder] })).ok).toBe(false);
  });
  it("rejects malformed tombstones, conflicting live/tombstone ids and dangling folders", () => {
    expect(validateBackup(backupFixture({ tombstones: [{ id: "gone", purgedAt: "bad" }] })).ok).toBe(false);
    expect(validateBackup(backupFixture({ tombstones: [{ id: noteFixture().id, purgedAt: AT }] })).ok).toBe(false);
    expect(validateBackup(backupFixture({ notes: [noteFixture({ folderId: "missing" })] })).errors.join(" ")).toContain("dangling folderId");
  });
  it.each([{ secret: "x" }, { lastBackupAt: false }, { toolbar: "bold" }, { toolbar: [2] }])("rejects unknown or malformed preferences %j", (preferences) => {
    expect(validateBackup(backupFixture({ preferences })).ok).toBe(false);
  });
  it("rejects prototype-like preference names too", () => {
    const raw = JSON.parse(JSON.stringify(backupFixture()));
    raw.preferences = JSON.parse('{"__proto__":{"apiKey":"x"}}');
    expect(validateBackup(raw).ok).toBe(false);
  });
  it("buildBackup refuses corrupt rows instead of producing an unusable recovery file", async () => {
    await db.notes.add(noteFixture({ folderId: "absent" }));
    await expect(buildBackup()).rejects.toThrow("Could not back up");
  });
  it("still returns errors if non-JSON caller input throws while being read", () => {
    const raw = { get notes() { throw null; } };
    expect(validateBackup(raw)).toMatchObject({ ok: false, envelope: null });
  });
});

it("runs pure upgrades one version at a time and validates each resulting schema", () => {
  const raw = { schemaVersion: 1, rows: ["original"] };
  const seen = [];
  const validators = Object.fromEntries([1, 2, 3].map((version) => [version, (envelope) => seen.push(envelope.schemaVersion)]));
  const upgrades = {
    1: (envelope) => ({ ...envelope, schemaVersion: 2, rows: [...envelope.rows, "v2"] }),
    2: (envelope) => ({ ...envelope, schemaVersion: 3, rows: [...envelope.rows, "v3"] }),
  };
  expect(upgradeEnvelope(raw, 3, upgrades, validators).envelope).toEqual({ schemaVersion: 3, rows: ["original", "v2", "v3"] });
  expect(seen).toEqual([1, 2, 3]);
  expect(raw).toEqual({ schemaVersion: 1, rows: ["original"] });
  expect(() => upgradeEnvelope(raw, 3, {}, validators)).toThrow("No upgrade");
  expect(() => upgradeEnvelope(raw, 3, { 1: () => ({ schemaVersion: 3 }) }, validators)).toThrow("one schema version");
  const failValidation = { ...validators, 2: (_raw, errors) => errors.push("Bad v2") };
  expect(upgradeEnvelope(raw, 3, upgrades, failValidation).errors).toEqual(["Bad v2"]);
  expect(() => upgradeEnvelope({ schemaVersion: 0 })).toThrow("not supported");
});
