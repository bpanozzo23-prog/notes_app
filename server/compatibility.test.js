// Uses jsdom because the app's backup and editor modules share browser-only dependencies.
import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { EXPORTED_PREFS, validateBackup } from "../src/db/backup.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "../src/db/files.js";
import { SAFE_STRING, isSafeId } from "../src/lib/ids.js";
import { extractFileIds, extractNoteLinks } from "../src/lib/text.js";
import { FORMATTING_KEYS } from "../src/editor/formatting.js";
import { SUPPORTED_HTML_SAMPLES } from "../src/editor/extensions.js";
import { SCHEMA_VERSION } from "../src/version.js";
import * as copied from "./constants.mjs";
import { buildBackup, dailyBackup, localDay } from "./backup.mjs";
import { mkdir, readJson } from "./fsutil.mjs";
import { AT, PNG, file, fixture, note, push } from "./test-support.js";

let f;
afterEach(async () => { await f?.clean(); f = null; });
it("keeps every copied constant equal to the app contract", () => {
  expect(copied.EXPORTED_PREFS).toEqual(EXPORTED_PREFS);
  expect(copied.FORMATTING_KEYS).toEqual(FORMATTING_KEYS);
  expect(copied.IMAGE_TYPES).toEqual(IMAGE_TYPES);
  expect(copied.MAX_IMAGE_BYTES).toBe(MAX_IMAGE_BYTES);
  expect(copied.SCHEMA_VERSION).toBe(SCHEMA_VERSION);
  expect(copied.SAFE_STRING.source).toBe(SAFE_STRING.source);
  expect(copied.SAFE_STRING.flags).toBe(SAFE_STRING.flags);
  for (const value of [null, 1, "", " ", " a ", "\0", "x".repeat(512), "x".repeat(513), "中文", "🍊", "__proto__"]) {
    expect(copied.isSafeId(value)).toBe(isSafeId(value));
  }
});
const tricky = [
  '<IMG DATA-FILE="a&amp;b" alt=">"><img data-file=\'c&#39;d\'><img data-file=unquoted>',
  '<img data-file="first" data-file="second"><img data-file="" data-file="ignored">',
  '<img data-file="你好"><img data-file="&#x1f34a;"><img data-file="&#1114111;">',
  '<img data-file="&QUOT;quote&quot;"><img data-file="&nbsp;"><img data-file="&#0;">',
  '<img data-file="&#x110000;"><img data-file="&#10;"><img data-file="a">',
  '<img data-file="a"><img data-file="a"><a data-file="ignored">Link</a>',
  '<!-- <img data-file="in-comment"> --><script><img data-file="in-script"></script>',
  `<img data-file="${"x".repeat(512)}"><img data-file="${"x".repeat(513)}">`,
  '<img title="data-file=wrong" data-file="right"><img data-file><img data-file="unclosed',
  "<p>Text only</p>",
];
it.each([...SUPPORTED_HTML_SAMPLES, ...tricky])("extracts image ids identically from %s", (html) => {
  expect(copied.extractFileIds(html)).toEqual(extractFileIds(html));
});
it.each([...SUPPORTED_HTML_SAMPLES, ...tricky,
  '<A HREF=" NOTE:a&amp;b ">x</A><a href=note:c><a href=\'note:&#x1f34a;\'>',
  '<a href="note:first" href="note:second"><a href="note:with space"><a href="note:">',
  '<!-- <a href="note:comment"> --><a title=">" href="Note:你好">',
])("extracts note links identically from %s", (html) => {
  expect(copied.extractNoteLinks(html)).toEqual(extractNoteLinks(html));
});
async function healthyFixture() {
  f = await fixture();
  await f.request("PUT", "/v1/files/image-1?generation=generation-A", PNG);
  const notes = [note({ html: '<p>Fixture</p><img data-file="image-1">', folderId: "folder" }),
    note({ id: "trash", html: '<img data-file="image-1">', deletedAt: AT })];
  const response = await f.request("POST", "/v1/push", push(notes, {
    files: [file()], folders: [{ id: "folder", name: "Fixture folder", position: 0 }],
    tombstones: [{ id: "purged", purgedAt: AT }], preferences: { lastBackupAt: AT, toolbarLayout: "rows" },
  }));
  expect(response.status).toBe(200);
}
it("builds a healthy app-compatible backup including Trash with no errors or warnings", async () => {
  await healthyFixture();
  const envelope = await buildBackup(f.context.store, AT);
  expect(envelope).toMatchObject({ format: "notes_app-backup", schemaVersion: 4, appVersion: "0.3.11",
    exportedAt: AT, preferences: { lastBackupAt: AT, toolbarLayout: "rows" } });
  expect(envelope.notes).toHaveLength(2);
  expect(envelope.files).toEqual([{ ...file(), data: PNG.toString("base64") }]);
  expect(validateBackup(envelope)).toMatchObject({ ok: true, errors: [], warnings: [] });
  const http = await f.request("GET", "/v1/backup");
  expect(validateBackup(JSON.parse(http.body))).toMatchObject({ ok: true, errors: [], warnings: [] });
});
it("missing image objects produce exactly the app's expected warning per referencing note", async () => {
  await healthyFixture();
  const hash = f.context.store.published.files["image-1"].sha256;
  await fs.unlink(path.join(f.context.store.objects, hash));
  const envelope = await buildBackup(f.context.store, AT);
  const checked = validateBackup(envelope);
  expect(checked.ok).toBe(true);
  expect(checked.errors).toEqual([]);
  expect(checked.warnings).toEqual(["Note note-1 shows a missing image.", "Note trash shows a missing image."]);
});
it("a damaged fixture with no metadata gives one missing-image warning and no errors", async () => {
  f = await fixture();
  await f.request("POST", "/v1/push", push([note({ html: '<img data-file="absent">' })]));
  const checked = validateBackup(await buildBackup(f.context.store, AT));
  expect(checked).toMatchObject({ ok: true, errors: [], warnings: ["Note note-1 shows a missing image."] });
});
it("view/inbox edits and unreferenced objects never enter backups", async () => {
  await healthyFixture();
  const before = await buildBackup(f.context.store, AT);
  await mkdir(path.join(f.config.viewDir, "notebook"));
  await mkdir(path.join(f.config.viewDir, "inbox"));
  await fs.chmod(path.join(f.config.viewDir, "notebook/notebook.md"), 0o600);
  await fs.writeFile(path.join(f.config.viewDir, "notebook/notebook.md"), "Untrusted changed fixture");
  await fs.writeFile(path.join(f.config.viewDir, "inbox/proposal.json"), '{"html":"Untrusted fixture"}');
  await f.context.store.putObject(Buffer.from("Unreferenced fixture"));
  expect(await buildBackup(f.context.store, AT)).toEqual(before);
});
it("writes once per local day after a round and retains the fourteen newest dates", async () => {
  f = await fixture();
  await dailyBackup(f.context.store, AT);
  expect(await fs.readdir(f.context.store.backups)).toEqual([]);
  await f.request("POST", "/v1/push", push());
  const firstFile = path.join(f.context.store.backups, `notes-backup-${localDay(AT)}.json`);
  await f.request("POST", "/v1/push", await f.next([note({ title: "Later same day", rev: 2 })]));
  expect((await readJson(firstFile)).notes[0].title).toBe("Fixture title");
  for (let i = 1; i <= 15; i++) await dailyBackup(f.context.store, Date.parse(AT) + i * 86400000);
  const names = (await fs.readdir(f.context.store.backups)).sort();
  expect(names).toHaveLength(14);
  expect(names[0]).toBe(`notes-backup-${localDay(Date.parse(AT) + 2 * 86400000)}.json`);
  expect(names.at(-1)).toBe(`notes-backup-${localDay(Date.parse(AT) + 15 * 86400000)}.json`);
});
