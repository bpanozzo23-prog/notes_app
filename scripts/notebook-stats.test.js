// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { collectStats, scanHtml } from "./notebook-stats.mjs";

// A made-up store in a temporary folder, in the sync service's layout, with three rounds of history.
const SECRETS = ["ZEBRAQUARTZ", "XYLOPHONEFOLDER", "KUMQUATTAG", "MARZIPANBODY"];
const key = (id) => createHash("sha256").update(id).digest("hex");
let repo;

function commit(message, date) {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["-C", repo, "add", "-A"], { env });
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", message], { env });
}
const write = (file, value) => fs.writeFileSync(path.join(repo, file), JSON.stringify(value));
const note = (id, extra = {}) => ({ id, title: `ZEBRAQUARTZ ${id}`, html: "<p>MARZIPANBODY</p>", text: "MARZIPANBODY",
  linkedIds: [], tags: [], folderId: null, pinned: false, quickAdd: false, addDate: false, rev: 1,
  createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-20T09:00:00.000Z", deletedAt: null, ...extra });
const put = (row) => write(`notes/${key(row.id)}.json`, row);

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "notebook-stats-test-"));
  fs.mkdirSync(path.join(repo, "notes"));
  fs.mkdirSync(path.join(repo, "proposals"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  for (const [name, value] of [["user.name", "fixture"], ["user.email", "fixture@localhost"]]) {
    execFileSync("git", ["-C", repo, "config", "--local", name, value]);
  }
  // Round 1: three notes, one folder.
  write("folders.json", [{ id: "f1", name: "XYLOPHONEFOLDER", position: 0 }]);
  write("tombstones.json", []);
  write("files.json", { "image-1": { sha256: "0".repeat(64), type: "image/webp", size: 1234 } });
  write("preferences.json", { toolbar: ["bold", "italic"], namedStyles: [] });
  put(note("a", { folderId: "f1", tags: ["KUMQUATTAG"] }));
  put(note("b"));
  put(note("c"));
  commit("round 1", "2026-10-20T09:05:00Z");
  // Round 2: a is edited the next day with formatting and moved out of its folder; b goes to Trash.
  put(note("a", { rev: 2, folderId: null, tags: ["KUMQUATTAG"], updatedAt: "2026-10-21T15:00:00.000Z",
    text: "MARZIPANBODY and more", html: '<h2>MARZIPANBODY</h2><div data-callout="tip"><p>MARZIPANBODY</p></div>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>x</p></li></ul>' +
      '<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul><p><a href="https://example.invalid/MARZIPANBODY">x</a>' +
      '<span style="color: #ff0000; font-size: 20px">x</span><img data-file="image-1"></p>' }));
  put(note("b", { rev: 2, deletedAt: "2026-10-21T15:10:00.000Z" }));
  write("preferences.json", { toolbar: ["bold", "italic", "callout"], namedStyles: [{ name: "ZEBRAQUARTZ" }] });
  commit("round 2", "2026-10-21T15:15:00Z");
  // Round 3: c is deleted for good; a second folder appears.
  fs.rmSync(path.join(repo, `notes/${key("c")}.json`));
  write("folders.json", [{ id: "f1", name: "XYLOPHONEFOLDER", position: 0 }, { id: "f2", name: "XYLOPHONEFOLDER 2", position: 1 }]);
  commit("round 3", "2026-10-22T10:00:00Z");
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

it("counts the notebook and its history", () => {
  const stats = collectStats(repo, { now: new Date("2026-10-23T00:00:00Z") });
  expect(stats.totals).toMatchObject({ notes: 2, live: 1, trashed: 1, purgedInHistory: 1, folders: 2, images: 1, imageBytes: 1234 });
  expect(stats.history.rounds).toBe(3);
  expect(stats.events).toMatchObject({ moves: 1, trashed: 1, purged: 1, renames: 0 });
  expect(stats.folderChanges).toMatchObject({ created: 1, countFirst: 1, countNow: 2 });
  expect(stats.formatting.notesUsing).toMatchObject({ heading2: 1, callouts: 1, checklists: 1, bulletLists: 1, nestedLists: 1,
    textColour: 1, fontSize: 1, images: 1, externalLinks: 1 });
  expect(stats.formatting.preferences).toMatchObject({ toolbar: ["bold", "italic", "callout"], namedStyles: 1, changesInHistory: { toolbar: 1, namedStyles: 1 } });
  expect(stats.notes).toHaveLength(1);
  expect(stats.notes[0]).toMatchObject({ note: expect.stringMatching(/^N\d$/), folder: "(no folder)", sittings: 2, editDays: 2, tags: 1, images: 1 });
  expect(stats.rhythm.sittings).toBe(4); // a twice, b once, c once
});

it("prints no note text, and titles, folder and tag names only when asked", () => {
  const plain = JSON.stringify(collectStats(repo));
  for (const secret of SECRETS) expect(plain).not.toContain(secret);
  const named = JSON.stringify(collectStats(repo, { names: true }));
  expect(named).toContain("ZEBRAQUARTZ a");
  expect(named).toContain("KUMQUATTAG");
  expect(named).not.toContain("MARZIPANBODY");
  expect(named).not.toContain("ZEBRAQUARTZ b"); // Trash stays unnamed
});

it("leaves the store untouched", () => {
  const before = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" });
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
  collectStats(repo);
  expect(execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" })).toBe(before);
  expect(execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" })).toBe(head);
});

it("scans HTML without keeping words", () => {
  const scan = scanHtml('<p data-secret="MARZIPANBODY" data-callout="MARZIPAN BODY">MARZIPANBODY</p>');
  expect(JSON.stringify(scan)).not.toContain("MARZIPAN");
  expect(scan.attributes["data-secret"]).toBe(1);
});
