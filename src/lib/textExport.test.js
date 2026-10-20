import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { noteFixture } from "../test/fixtures.js";
import { notebookToText, noteToText } from "./textExport.js";

const now = new Date(2026, 9, 18, 14, 52);
const folders = [{ id: "b", name: "Reading", position: 1 }, { id: "a", name: "Español", position: 0 }];
const note = (id, overrides = {}) => noteFixture({ id, title: id, ...overrides });

it("uses folder position, No folder last, pinned/recent/id order, and excludes Trash", () => {
  const notes = [
    note("unfiled"), note("reading", { folderId: "b" }),
    note("old", { folderId: "a", updatedAt: "2026-10-01T12:00:00Z" }),
    note("new-z", { folderId: "a" }), note("new-a", { folderId: "a" }),
    note("pinned", { folderId: "a", pinned: true, updatedAt: "2026-09-01T12:00:00Z" }),
    note("TRASH-SECRET", { folderId: "a", deletedAt: "2026-10-17" }),
  ];
  const text = notebookToText({ notes, folders, now });
  expect(text.split("\n").filter((line) => /^#{2,3} /.test(line))).toEqual([
    "## Español", "### pinned", "### new-a", "### new-z", "### old", "## Reading", "### reading", "## No folder", "### unfiled",
  ]);
  expect(text).toContain("6 notes.");
  expect(text).not.toContain("TRASH-SECRET");
  expect(folders[0].id).toBe("b"); // Pure: sorting must not change the caller's folder order.
});

it("formats the header, metadata, headings, images and links without HTML", () => {
  const target = note("target", { title: "", text: "Fallback title\nMore" });
  const source = note("Vocabulario", { folderId: "a", tags: ["spanish", "vocab"], pinned: true,
    createdAt: new Date(2026, 9, 1, 12).toISOString(), updatedAt: new Date(2026, 9, 16, 12).toISOString(),
    html: '<h1>Words</h1><h3>Details</h3><p><a href="note:target">See</a></p><img data-file="image-fixture"><p><a href="note:trash">Old</a></p>',
  });
  const notes = [source, target, note("trash", { title: "SECRET", deletedAt: "2026-10-17" })];
  const text = notebookToText({ notes, folders, now });
  expect(text).toContain('# Notes — exported 18 Oct 2026, 14:52\n2 notes. Made by notes_app. Pictures appear as [image]; links between notes as "text [→ Title]".');
  expect(text).toContain("### Vocabulario\nTags: spanish, vocab · Created 1 Oct 2026 · Edited 16 Oct 2026 · Pinned\n\n#### Words\n\n###### Details");
  expect(text).toContain("See [→ Fallback title]");
  expect(text).toContain("[image]");
  expect(text).toContain("Old [→ a deleted note]");
  expect(text).not.toMatch(/SECRET|<h1>|data-file/);
  expect(noteToText(source, folders, notes)).toBe("# Vocabulario\nFolder: Español · Tags: spanish, vocab · Created 1 Oct 2026 · Edited 16 Oct 2026 · Pinned\n\n## Words\n\n#### Details\n\nSee [→ Fallback title]\n\n[image]\n\nOld [→ a deleted note]\n");
});

it("exports empty notes, fallback titles and missing folders, omitting empty tags", () => {
  const empty = note("empty", { title: " ", text: "", html: "<p></p>", folderId: "missing" });
  expect(noteToText(empty, folders, [empty])).toBe("# Untitled note\nFolder: No folder · Created 16 Oct 2026 · Edited 16 Oct 2026\n\n(empty note)\n");
  const text = notebookToText({ notes: [empty], folders, now });
  expect(text).toContain("1 note.");
  expect(text).toContain("## No folder\n\n### Untitled note");
  expect(text).not.toMatch(/Tags:|## Español/);
  expect(notebookToText({ notes: [], folders, now })).toContain("0 notes.");
});

it("exports the public sample deterministically without preferences or image bytes", () => {
  const sample = JSON.parse(readFileSync(resolve(__dirname, "../../public/sample-notebook.json"), "utf8"));
  const text = notebookToText({ ...sample, now });
  expect(notebookToText({ ...sample, now })).toBe(text);
  expect(text).toMatchSnapshot();
  expect(text).not.toMatch(/base64|data:image|sk-ant/);
  expect(notebookToText({ ...sample, preferences: { claudeApiKey: "sk-ant-SENTINEL", anything: "PREF-SENTINEL" }, now })).toBe(text);
});

it("view output includes ids, uses UTC, and derives its time only from the newest live edit", () => {
  const notes = [
    note("first", { createdAt: "2026-10-01T00:30:00.000Z", updatedAt: "2026-10-19T23:05:00.000Z" }),
    note("second", { updatedAt: "2026-10-20T00:30:00.000Z" }),
    note("trash", { updatedAt: "2099-01-01T00:00:00.000Z", deletedAt: "2026-10-20" }),
  ];
  const before = process.env.TZ;
  try {
    process.env.TZ = "America/Chicago";
    const text = notebookToText({ notes, folders, now, view: true });
    expect(text).toContain("# Notes — as of 20 Oct 2026, 00:30 UTC");
    expect(text).toContain("id: first · Created 1 Oct 2026 · Edited 19 Oct 2026");
    process.env.TZ = "Pacific/Auckland";
    expect(notebookToText({ notes, folders, now: "2099-12-31", view: true })).toBe(text);
    expect(text).not.toContain("id: trash");
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

it("empty view output has a fixed No notes yet line, independent of wall-clock time", () => {
  const first = notebookToText({ notes: [], folders, view: true });
  expect(first).toContain("# Notes — No notes yet\n0 notes.");
  expect(notebookToText({ notes: [], folders, now: "2099-01-01", view: true })).toBe(first);
});
