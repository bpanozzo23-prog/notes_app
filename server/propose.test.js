// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { AT, fixture, note, push } from "./test-support.js";
import { keyFor, readJson } from "./fsutil.mjs";
import { propose } from "./propose.mjs";
import { proposalProblem, referenceProblem } from "./proposals.mjs";

let f, lines;
beforeEach(async () => {
  f = await fixture();
  await f.request("POST", "/v1/push", push([note({ html: '<p>Fixture</p><img data-file="existing">' }), note({ id: "other" })],
    { folders: [{ id: "folder", name: "Folder", position: 0 }] }));
  lines = [];
});
afterEach(async () => { await f?.clean(); });
const helper = (...args) => propose(args, { viewDir: f.config.viewDir, print: (line) => lines.push(line) });
const draftDir = () => path.join(f.config.viewDir, `inbox/drafts/${keyFor("note-1")}`);
const view = (name) => path.join(f.config.viewDir, name);
async function editMetadata(extra) {
  const filename = path.join(draftDir(), "proposal.json");
  await fs.writeFile(filename, JSON.stringify({ ...await readJson(filename), ...extra }));
}
const valid = () => ({ note: "note-1", basedOnRev: 1, generation: "generation-A", title: "", folderId: null, tags: [], why: "", body: "" });
it("draft copies exact HTML and metadata, refuses existing/unknown drafts and supports --force", async () => {
  expect(await helper("draft", "missing")).toBe(1);
  expect(await helper("draft", "note-1")).toBe(0);
  expect(await readJson(path.join(draftDir(), "proposal.json"))).toEqual({
    note: "note-1", basedOnRev: 1, generation: "generation-A", title: "Fixture title", folderId: null, tags: [], why: "",
  });
  expect(await fs.readFile(path.join(draftDir(), "body.html"), "utf8")).toBe('<p>Fixture</p><img data-file="existing">');
  await editMetadata({ title: "Unsaved work" });
  expect(await helper("draft", "note-1")).toBe(1);
  expect((await readJson(path.join(draftDir(), "proposal.json"))).title).toBe("Unsaved work");
  expect(await helper("draft", "note-1", "--force")).toBe(0);
  expect((await readJson(path.join(draftDir(), "proposal.json"))).title).toBe("Fixture title");
});
it.each([
  ["title", "x".repeat(201), "invalid-title"], ["title", "bad\nname", "invalid-title"],
  ["title", "bad\u0085name", "invalid-title"],
  ["title", 3, "invalid-title"], ["tags", [" spaced "], "invalid-tags"], ["tags", ["a", "a"], "invalid-tags"],
  ["tags", ["\u007f"], "invalid-tags"], ["tags", ["x".repeat(513)], "invalid-tags"],
  ["tags", Array.from({ length: 51 }, (_, i) => String(i)), "invalid-tags"],
  ["why", "x".repeat(301), "invalid-why"], ["why", null, "invalid-why"],
  ["folderId", 42, "invalid-folder"], ["basedOnRev", 0, "invalid-rev"],
  ["generation", {}, "invalid-generation"], ["body", "é".repeat(256 * 1024 + 1), "invalid-body"],
  ["note", "../\0", "invalid-note"], ["pinned", true, "invalid-shape"],
])("shape check refuses %s boundary", (field, input, reason) => {
  expect(proposalProblem({ ...valid(), [field]: input })).toBe(reason);
});
it("accepts exact size boundaries, empty titles/bodies, safe long tags and arbitrary formatting", () => {
  expect(proposalProblem({ ...valid(), title: "x".repeat(200), tags: ["x".repeat(512)],
    why: "x".repeat(300), body: "a".repeat(512 * 1024) })).toBeNull();
  expect(proposalProblem({ ...valid(), body: "<unsupported>Phone audits this</unsupported>" })).toBeNull();
});
it.each([
  [{ folderId: "missing" }, "unknown-folder"],
  [{ body: '<a href="note:missing">Link</a>' }, "unknown-note-link"],
  [{ body: '<a href="NOTE:other">Link</a><img data-file="elsewhere">' }, "new-image"],
])("checks references against the live index: %j", (extra, reason) => {
  const index = { notes: [{ id: "note-1", images: ["existing"] }, { id: "other", images: [] }] };
  expect(referenceProblem({ ...valid(), ...extra }, index, [{ id: "folder" }])).toBe(reason);
});
it("check leaves drafts alone; submit writes a complete file atomically, then removes the draft", async () => {
  await helper("draft", "note-1");
  await editMetadata({ title: "Suggestion", folderId: "folder", tags: ["test"], why: "Made-up edit" });
  await fs.writeFile(path.join(draftDir(), "body.html"), '<p><a href="note:other">Other</a></p><img data-file="existing">');
  expect(await helper("check", "note-1")).toBe(0);
  expect(await fs.readdir(view("inbox/pending"))).toEqual([]);
  expect(await helper("submit", "note-1")).toBe(0);
  const names = await fs.readdir(view("inbox/pending"));
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^p-[a-z0-9-]{8,80}\.json$/);
  const body = await readJson(view(`inbox/pending/${names[0]}`));
  expect(body).toMatchObject({ proposal: names[0].slice(0, -5), title: "Suggestion", basedOnRev: 1, why: "Made-up edit" });
  expect(body.body).toContain('data-file="existing"');
  expect((await fs.stat(view(`inbox/pending/${names[0]}`))).mode & 0o777).toBe(0o600);
  await expect(fs.stat(draftDir())).rejects.toHaveProperty("code", "ENOENT");
});
it.each(["rev", "generation", "trash"])("submit refuses a moved %s and preserves the draft", async (kind) => {
  await helper("draft", "note-1");
  const filename = view("notebook/index.json");
  const index = await readJson(filename);
  if (kind === "rev") index.notes.find((n) => n.id === "note-1").rev++;
  else if (kind === "generation") index.generation = "new-generation";
  else index.notes = index.notes.filter((n) => n.id !== "note-1");
  await fs.chmod(filename, 0o600);
  await fs.writeFile(filename, JSON.stringify(index));
  expect(await helper("submit", "note-1")).toBe(1);
  expect(await fs.readdir(view("inbox/pending"))).toEqual([]);
  expect(await fs.readdir(draftDir())).toHaveLength(2);
});
it.each([false, true])("refuses a second pending proposal (ingested: %s)", async (ingested) => {
  await helper("draft", "note-1"); await helper("submit", "note-1");
  if (ingested) await f.request("GET", "/v1/state");
  await helper("draft", "note-1");
  expect(await helper("submit", "note-1")).toBe(1);
  expect(lines.at(-1)).toContain("pending");
  expect(await fs.readdir(view("inbox/pending"))).toHaveLength(1);
});
it("list cleans only handled versions with matching content; withdraw removes the selected pending file", async () => {
  await helper("draft", "note-1"); await helper("submit", "note-1");
  const p = (await f.request("GET", "/v1/state")).body.proposals[0];
  await f.request("POST", "/v1/outcomes", [{ proposal: p.proposal, hash: p.hash, outcome: "dismissed", at: AT }]);
  const filename = view(`inbox/pending/${p.proposal}.json`);
  const original = await fs.readFile(filename, "utf8");
  await fs.writeFile(filename, JSON.stringify({ ...JSON.parse(original), body: "Changed after ingestion" }));
  expect(await helper("list")).toBe(0);
  expect(await fs.readdir(view("inbox/pending"))).toHaveLength(1);
  await fs.writeFile(filename, original);
  expect(await helper("list")).toBe(0);
  expect(lines.at(-1)).toContain('"status":"dismissed"');
  expect(await fs.readdir(view("inbox/pending"))).toEqual([]);
  await helper("draft", "note-1"); await helper("submit", "note-1");
  const next = (await f.request("GET", "/v1/state")).body.proposals[0];
  expect(await helper("withdraw", next.proposal)).toBe(0);
  expect((await f.request("GET", "/v1/state")).body.proposals).toEqual([]);
});
it.each(["inbox/drafts", "inbox/pending", "notebook"])("helper refuses symlinked %s", async (relative) => {
  await helper("draft", "note-1");
  const before = await fs.readFile(f.context.store.file("meta.json"));
  await fs.rm(view(relative), { recursive: true });
  await fs.symlink(f.context.store.repo, view(relative));
  expect(await helper("submit", "note-1")).toBe(1);
  expect(await fs.readFile(f.context.store.file("meta.json"))).toEqual(before);
});
it("a symlinked draft body is not read and withdraw never follows a symlink", async () => {
  await helper("draft", "note-1");
  const body = path.join(draftDir(), "body.html");
  await fs.unlink(body);
  await fs.symlink(f.context.store.file("notebook.md"), body);
  expect(await helper("check", "note-1")).toBe(1);
  const link = view("inbox/pending/p-fixture-link.json");
  await fs.symlink(f.context.store.file("notebook.md"), link);
  expect(await helper("withdraw", "p-fixture-link")).toBe(0);
  expect(await fs.readFile(f.context.store.file("notebook.md"), "utf8")).toBe("# Fixture\n");
});
it("returns usage/refusal/success exit codes from the actual CLI using NOTES_VIEW", async () => {
  // Regular-file stdio also works in the no-socket sandbox (Node's pipe stdio may not).
  const command = async (args) => {
    const output = path.join(f.root, "helper-output.txt");
    const handle = await fs.open(output, "w", 0o600);
    try {
      const child = spawn(process.execPath, [path.join(import.meta.dirname, "propose.mjs"), ...args],
        { cwd: f.root, env: { ...process.env, NOTES_VIEW: f.config.viewDir }, stdio: ["ignore", handle.fd, handle.fd] });
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      return { code, stdout: await fs.readFile(output, "utf8") };
    } finally { await handle.close(); }
  };
  expect((await command([])).code).toBe(2);
  expect((await command(["draft", "unknown"])).code).toBe(1);
  expect(await command(["draft", "note-1"])).toMatchObject({ code: 0, stdout: expect.stringContaining("Draft ready:") });
  expect(await helper("withdraw", "../../private")).toBe(1);
  expect(await helper("check", "note-1", "--force")).toBe(2);
});
