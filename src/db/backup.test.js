import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, allPrefs, setPref } from "./db.js";
import { buildBackup, validateBackup, importBackup, backupFilename, upgradeEnvelope, EXPORTED_PREFS } from "./backup.js";
import { createFolder } from "./folders.js";
import { createNote, updateNote, trashNote } from "./notes.js";
import { DEFAULT_FORMATTING } from "../editor/formatting.js";
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
  for (const [key, value] of Object.entries(DEFAULT_FORMATTING)) await setPref(key, value);
  await setPref("toolbar", ["bold", "italic"]);
  await setPref("storagePersisted", true);
  await setPref("futureApiKey", "fixture-only-secret");
  const before = await buildBackup();
  expect(Object.keys(before.preferences).sort()).toEqual([...EXPORTED_PREFS].sort());
  expect(JSON.stringify(before)).not.toContain("fixture-only-secret");
  const checked = validateBackup(JSON.stringify(before));
  expect(checked.ok).toBe(true);
  expect(checked.summary).toEqual({ notes: 2, folders: 1, tombstones: 1, trashed: 1, images: 0, imageBytes: 0, willUpgrade: false });
  await createNote({ title: "To be replaced" });
  await importBackup(checked.envelope);
  const after = await buildBackup();
  for (const key of ["notes", "folders", "tombstones", "preferences"]) expect(after[key]).toEqual(before[key]);
  // Device-local preferences are not in the file and must survive a restore (a Phase 3 API key,
  // this device's storagePersisted answer).
  expect(await allPrefs()).toEqual({ ...before.preferences, futureApiKey: "fixture-only-secret", storagePersisted: true, notebookGeneration: expect.any(String) });
});
it("ignores storagePersisted from older backups with a warning instead of restoring it", async () => {
  const checked = validateBackup(backupFixture({ preferences: { storagePersisted: true } }));
  expect(checked.ok).toBe(true);
  expect(checked.warnings.join(" ")).toContain("storagePersisted");
  await importBackup(checked.envelope);
  expect(await allPrefs()).toEqual({ notebookGeneration: expect.any(String) });
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
    ["format", "wrong"], ["schemaVersion", undefined], ["schemaVersion", 0], ["schemaVersion", 5],
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

it("runs synthetic future upgrades one version at a time and validates each resulting schema", () => {
  const raw = { schemaVersion: 10, rows: ["original"] };
  const seen = [];
  const validators = Object.fromEntries([10, 11, 12].map((version) => [version, (envelope) => seen.push(envelope.schemaVersion)]));
  const upgrades = {
    10: (envelope) => ({ ...envelope, schemaVersion: 11, rows: [...envelope.rows, "v11"] }),
    11: (envelope) => ({ ...envelope, schemaVersion: 12, rows: [...envelope.rows, "v12"] }),
  };
  expect(upgradeEnvelope(raw, 12, upgrades, validators).envelope).toEqual({ schemaVersion: 12, rows: ["original", "v11", "v12"] });
  expect(seen).toEqual([10, 11, 12]);
  expect(raw).toEqual({ schemaVersion: 10, rows: ["original"] });
  expect(() => upgradeEnvelope(raw, 12, {}, validators)).toThrow("No upgrade");
  expect(() => upgradeEnvelope(raw, 12, { 10: () => ({ schemaVersion: 12 }) }, validators)).toThrow("one schema version");
  const failValidation = { ...validators, 11: (_raw, errors) => errors.push("Bad v11") };
  expect(upgradeEnvelope(raw, 12, upgrades, failValidation).errors).toEqual(["Bad v11"]);
  expect(() => upgradeEnvelope({ schemaVersion: 0 })).toThrow("not supported");
});

it("keeps v1 validation unchanged, including the original preference allow-list and unlimited safe toolbar", () => {
  const toolbar = [...Array(101).fill("bold"), "x".repeat(512)];
  const raw = backupFixture({ preferences: { toolbar, storagePersisted: true } });
  const v1 = upgradeEnvelope(raw, 1);
  expect(v1.envelope).toEqual(raw);
  expect(v1.errors).toEqual([]);
  expect(v1.warnings).toEqual(["Preference storagePersisted is specific to the device it was exported from and will be ignored."]);
  for (const key of ["toolbarLayout", "selectionMenu", "textColors", "highlightColors", "namedStyles", "secret"]) {
    expect(upgradeEnvelope(backupFixture({ preferences: { [key]: [] } }), 1).errors).toEqual([`Preference ${key} is not allowed in backups.`]);
  }
  expect(upgradeEnvelope(backupFixture({ preferences: { toolbar: [2] } }), 1).errors).toEqual(["toolbar must be an array of action ids."]);
  const v2 = validateBackup(raw);
  expect(v2.ok).toBe(true);
  expect(v2.envelope.preferences.toolbar).toHaveLength(100);
  expect(v2.warnings.join(" ")).toContain("first 100");
  expect(v2.summary.willUpgrade).toBe(true);
  expect(raw.preferences.toolbar).toHaveLength(102);
});

it("the real 1-to-2 upgrade changes only the version, before v2 sanitisation", () => {
  const raw = backupFixture({ preferences: { toolbar: ["bold", "future"] } });
  const copy = structuredClone(raw);
  expect(upgradeEnvelope(raw, 2).envelope).toEqual({ ...raw, schemaVersion: 2 });
  expect(raw).toEqual(copy);
});

it("v2 warns and sanitises cosmetic preferences and unknown keys without blocking restoration", async () => {
  const raw = backupFixture({ schemaVersion: 2, preferences: {
    toolbar: ["bold", null, "future"], toolbarLayout: "sideways", selectionMenu: ["italic"],
    textColors: [{ color: "#ABCDEF", name: "  Sky ", hidden: false, custom: true }, { color: "red" }],
    highlightColors: "yellow", namedStyles: [null, DEFAULT_FORMATTING.namedStyles[0]],
    unknown: "ignored", notebookGeneration: "must-not-adopt", storagePersisted: false,
  } });
  const copy = structuredClone(raw);
  const result = validateBackup(raw);
  expect(result.ok).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.envelope.preferences).toEqual({
    toolbar: ["bold", "future"], selectionMenu: ["italic"], namedStyles: DEFAULT_FORMATTING.namedStyles,
    textColors: [{ color: "#abcdef", name: "Sky", hidden: false, custom: true }],
  });
  expect(result.warnings).toContain("Preference unknown is not recognised and will be ignored.");
  expect(raw).toEqual(copy);
  await setPref("toolbarLayout", "rows");
  await setPref("highlightColors", DEFAULT_FORMATTING.highlightColors);
  await setPref("storagePersisted", true);
  await importBackup(raw);
  expect(await allPrefs()).toEqual({ ...result.envelope.preferences, storagePersisted: true, notebookGeneration: expect.any(String) });
  expect((await allPrefs()).notebookGeneration).not.toBe("must-not-adopt");
  const backup = await buildBackup();
  expect(backup.schemaVersion).toBe(4);
  expect(backup.preferences).not.toHaveProperty("notebookGeneration");
});

it.each([
  { preferences: { lastBackupAt: false } }, { notes: [noteFixture({ rev: 0 })] },
  { notes: null }, { folders: null }, { tombstones: null }, { preferences: null },
])("v2 retains blocking v1 table and lastBackupAt errors: %j", (patch) => {
  const errors = validateBackup(backupFixture(patch)).errors;
  expect(errors.length).toBeGreaterThan(0);
  expect(validateBackup(backupFixture({ ...patch, schemaVersion: 2 })).errors).toEqual(errors);
});


it.each([1, 2, 3])("imports a v%s backup at schema 4 with rows unchanged", async (version) => {
  const raw = backupFixture({ schemaVersion: version, preferences: { toolbar: ["italic"] } });
  expect(upgradeEnvelope(raw).envelope).toEqual({ ...raw, schemaVersion: 4, files: [] });
  await importBackup(raw);
  expect((await buildBackup()).notes).toEqual(raw.notes);
  expect((await buildBackup()).preferences).toEqual(raw.preferences);
});
