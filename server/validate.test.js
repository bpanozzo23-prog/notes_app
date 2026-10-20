// @vitest-environment node
import { expect, it } from "vitest";
import { AT, file, note, push } from "./test-support.js";
import { MAX_IMAGE_BYTES, MAX_NOTEBOOK_BYTES } from "./constants.mjs";
import { validateOutcomes, validatePush } from "./validate.mjs";

it.each([
  ["null body", () => null],
  ["missing base", (p) => { delete p.base; }],
  ["negative base", (p) => { p.base.round = -1; }],
  ["fractional base", (p) => { p.base.round = 0.5; }],
  ["unsafe base", (p) => { p.base.round = Number.MAX_SAFE_INTEGER + 1; }],
  ["missing base generation", (p) => { delete p.base.generation; }],
  ["generation", (p) => { p.generation = 5; }],
  ["schema", (p) => { p.schemaVersion = 1.5; }],
  ["app version", (p) => { p.appVersion = " "; }],
  ["notebook", (p) => { p.notebookMd = 0; }],
  ["large notebook", (p) => { p.notebookMd = "é".repeat(MAX_NOTEBOOK_BYTES / 2 + 1); }],
  ["confirm", (p) => { p.confirm = {}; }],
  ["rows", (p) => { p.rows = {}; }],
  ["folders", (p) => { p.folders = null; }],
  ["tombstones", (p) => { p.tombstones = "no"; }],
  ["files", (p) => { p.files = null; }],
  ["ids", (p) => { p.ids = null; }],
  ["null row", (p) => { p.rows = [null]; }],
  ["id", (p) => { p.rows[0].id = ""; }],
  ["control id", (p) => { p.rows[0].id = "a\nb"; }],
  ["long id", (p) => { p.rows[0].id = "x".repeat(513); }],
  ["title", (p) => { p.rows[0].title = null; }],
  ["html", (p) => { p.rows[0].html = {}; }],
  ["text", (p) => { p.rows[0].text = 5; }],
  ["dangling folder", (p) => { p.rows[0].folderId = "absent"; }],
  ["bad folder id", (p) => { p.rows[0].folderId = 1; }],
  ["tags not strings", (p) => { p.rows[0].tags = [1]; }],
  ["untrimmed tags", (p) => { p.rows[0].tags = [" tag"]; }],
  ["duplicate tags", (p) => { p.rows[0].tags = ["tag", "tag"]; }],
  ["unsafe links", (p) => { p.rows[0].linkedIds = ["\n"]; }],
  ["duplicate links", (p) => { p.rows[0].linkedIds = ["x", "x"]; }],
  ["untrimmed links", (p) => { p.rows[0].linkedIds = ["x "]; }],
  ["pinned", (p) => { p.rows[0].pinned = 1; }],
  ["zero revision", (p) => { p.rows[0].rev = 0; }],
  ["unsafe revision", (p) => { p.rows[0].rev = Number.MAX_SAFE_INTEGER + 1; }],
  ["date offset", (p) => { p.rows[0].createdAt = "2026-10-19T12:00:00+00:00"; }],
  ["missing milliseconds", (p) => { p.rows[0].updatedAt = "2026-10-19T12:00:00Z"; }],
  ["nonexistent date", (p) => { p.rows[0].updatedAt = "2026-02-30T12:00:00.000Z"; }],
  ["trash date", (p) => { p.rows[0].deletedAt = "yesterday"; }],
  ["missing row rev in ids", (p) => { p.ids[0].rev = 2; }],
  ["row absent from ids", (p) => { p.ids = []; }],
  ["repeated ids", (p) => { p.ids.push(p.ids[0]); }],
  ["duplicate rows", (p) => { p.rows.push(p.rows[0]); }],
  ["bad folder", (p) => { p.folders = [{ id: "f", name: "", position: 0 }]; }],
  ["negative folder position", (p) => { p.folders = [{ id: "f", name: "F", position: -1 }]; }],
  ["fractional folder position", (p) => { p.folders = [{ id: "f", name: "F", position: 1.2 }]; }],
  ["bad tombstone", (p) => { p.tombstones = [{ id: "gone", purgedAt: null }]; }],
  ["cross table duplicate", (p) => { p.tombstones = [{ id: "note-1", purgedAt: AT }]; }],
  ["duplicate file", (p) => { p.files = [file({ id: "note-1" })]; }],
  ["unsupported image", (p) => { p.files = [file({ type: "image/svg+xml" })]; }],
  ["empty image", (p) => { p.files = [file({ size: 0 })]; }],
  ["large image", (p) => { p.files = [file({ size: MAX_IMAGE_BYTES + 1 })]; }],
  ["fractional dimension", (p) => { p.files = [file({ width: 1.5 })]; }],
  ["zero dimension", (p) => { p.files = [file({ width: 0 })]; }],
  ["large dimension", (p) => { p.files = [file({ height: 10001 })]; }],
  ["file date", (p) => { p.files = [file({ createdAt: "invalid" })]; }],
  ["preferences array", (p) => { p.preferences = []; }],
  ["secret preference", (p) => { p.preferences = { syncToken: "secret-sentinel" }; }],
  ["unknown preference", (p) => { p.preferences = { other: true }; }],
])("refuses %s with a short content-free error", (_, mutate) => {
  const original = push();
  const changed = mutate(original);
  let error;
  try { validatePush(changed === null ? null : original); } catch (e) { error = e; }
  expect(error?.status).toBe(400);
  expect(error.body.error).toMatch(/^[a-z-]+$/);
  expect(error.message).not.toContain("secret-sentinel");
});
it("allows opaque JSON preferences and all supported metadata boundaries", () => {
  const p = push([note({ folderId: "f" })], { folders: [{ id: "f", name: " Folder ", position: 0 }],
    files: [file({ size: MAX_IMAGE_BYTES, width: 1, height: 10000 })],
    preferences: { toolbar: { future: ["opaque", null, true, 2] }, lastBackupAt: AT } });
  expect(validatePush(p)).toBe(p);
});
it.each([
  null, {}, [null], [{ proposal: "../escape", hash: "a".repeat(64), outcome: "applied", at: AT }],
  [{ proposal: "p", hash: "bad", outcome: "applied", at: AT }],
  [{ proposal: "p", hash: "a".repeat(64), outcome: "", at: AT }],
  [{ proposal: "p", hash: "a".repeat(64), outcome: "applied", at: "yesterday" }],
])("rejects malformed outcomes %j", (body) => {
  expect(() => validateOutcomes(body)).toThrow();
});

it.each([
  [{ outcome: "deleted" }], [{ outcome: "APPLIED" }], [{ applied: "title" }], [{ applied: [""] }],
  [{ applied: Array.from({ length: 501 }, (_, i) => `t${i}`) }], [{ applied: ["x".repeat(201)] }],
])("rejects outcome words and tick lists outside the contract %j", (extra) => {
  expect(() => validateOutcomes([{ proposal: "p", hash: "a".repeat(64), outcome: "applied", at: AT, ...extra }])).toThrow();
});
it.each(["applied", "kept", "dismissed", "stale"])("accepts the outcome %s with or without ticks", (outcome) => {
  for (const applied of [undefined, null, [], ["title", "body-1"]]) {
    expect(() => validateOutcomes([{ proposal: "p", hash: "a".repeat(64), outcome, at: AT, applied }])).not.toThrow();
  }
});
