// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AT, PNG, fixture, note, file, push } from "./test-support.js";
import { keyFor, readJson, sha256, TEMP_PREFIX, writeJson } from "./fsutil.mjs";
import { proposalFilename } from "./proposals.mjs";
import { buildBackup } from "./backup.mjs";
import { rebuildView } from "./view.mjs";
import { withDirectory, writeInDirectory } from "./view-fs.mjs";
import { serve } from "./main.mjs";

let f;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { vi.restoreAllMocks(); await f?.clean(); });
const view = (name) => path.join(f.config.viewDir, name);
const rebuild = () => f.context.rebuildView();
async function seed() {
  await f.request("PUT", "/v1/files/image-1?generation=generation-A", PNG);
  expect((await f.request("POST", "/v1/push", push([
    note({ html: '<p>Fixture</p><img data-file="image-1">', folderId: "folder" }),
    note({ id: "trashed", deletedAt: AT }),
  ], { files: [file()], folders: [{ id: "folder", name: "Folder", position: 0 }] }))).status).toBe(200);
}
it("rebuilds exact live HTML, projection, image copies and metadata with explicit modes", async () => {
  await seed();
  const index = await readJson(view("notebook/index.json"));
  expect(index).toEqual({ generation: "generation-A", round: 1, notes: [{
    id: "note-1", file: keyFor("note-1"), title: "Fixture title", folderId: "folder", folder: "Folder",
    tags: [], pinned: false, createdAt: AT, updatedAt: AT, rev: 1, images: ["image-1"],
  }] });
  expect(await fs.readFile(view(`notebook/notes/${keyFor("note-1")}.html`), "utf8")).toBe('<p>Fixture</p><img data-file="image-1">');
  expect(await fs.readFile(view(`notebook/images/${keyFor("image-1")}.png`))).toEqual(PNG);
  expect((await fs.stat(view(`notebook/images/${keyFor("image-1")}.png`))).ino)
    .not.toBe((await fs.stat(path.join(f.context.store.objects, sha256(PNG)))).ino);
  expect(await fs.readFile(view("notebook/notebook.md"), "utf8")).toBe("# Fixture\n");
  const manifest = await readJson(path.join(f.config.storeDir, "view-manifest.json"));
  for (const [name, hash] of Object.entries(manifest)) {
    expect(sha256(await fs.readFile(view(name)))).toBe(hash);
    expect((await fs.stat(view(name))).mode & 0o777).toBe(0o444);
  }
  for (const name of ["", "notebook", "notebook/notes", "notebook/images", ".claude", "inbox"]) {
    expect((await fs.stat(view(name))).mode & 0o777).toBe(0o700);
  }
  expect(await fs.readdir(view("notebook/notes"))).toEqual([`${keyFor("note-1")}.html`]);
  expect(await fs.readdir(view("inbox"))).toEqual([]);
  expect(await fs.readdir(view(""))).not.toContain("propose");
});
it("tightens every existing view directory, including inbox, from 0755 to 0700", async () => {
  await seed();
  const directories = ["", "notebook", "notebook/notes", "notebook/images", ".claude", "inbox"];
  for (const name of directories) await fs.chmod(view(name), 0o755);
  await rebuild();
  for (const name of directories) expect((await fs.stat(view(name))).mode & 0o777).toBe(0o700);
});
it("creates pinned directories with a default mode of 0700", async () => {
  await withDirectory(f.config.viewDir, "notebook/notes", async () => {}, { create: true });
  for (const name of ["", "notebook", "notebook/notes"]) expect((await fs.stat(view(name))).mode & 0o777).toBe(0o700);
});
it("cleans interrupted view writes before writing, without following links, recursing or touching inbox", async () => {
  await seed();
  const directories = ["", "notebook", "notebook/notes", "notebook/images", ".claude"];
  const temporary = `${TEMP_PREFIX}${randomUUID()}`, link = `${TEMP_PREFIX}${randomUUID()}`;
  const nested = `${TEMP_PREFIX}${randomUUID()}`, sentinel = path.join(f.root, "sentinel.txt");
  await fs.writeFile(sentinel, "KEEP TARGET");
  for (const name of directories) {
    await fs.writeFile(view(path.join(name, temporary)), "INTERRUPTED NOTE TEXT");
    await fs.symlink(sentinel, view(path.join(name, link)));
    await fs.mkdir(view(path.join(name, nested)));
    await fs.writeFile(view(path.join(name, nested, temporary)), "KEEP NESTED");
    await fs.writeFile(view(path.join(name, "unexpected.txt")), "KEEP UNEXPECTED");
  }
  await fs.writeFile(view(`inbox/${temporary}`), "KEEP INBOX");
  await fs.symlink(sentinel, view(`inbox/${link}`));
  await fs.unlink(view("notebook/index.json"));
  const open = fs.open;
  vi.spyOn(fs, "open").mockImplementation(async (filename, ...args) => {
    if (path.basename(filename).startsWith(TEMP_PREFIX)) {
      for (const name of directories) {
        await expect(fs.lstat(view(path.join(name, temporary)))).rejects.toHaveProperty("code", "ENOENT");
        await expect(fs.lstat(view(path.join(name, link)))).rejects.toHaveProperty("code", "ENOENT");
      }
    }
    return open(filename, ...args);
  });
  await rebuild();
  for (const name of directories) {
    expect(await fs.readFile(view(path.join(name, nested, temporary)), "utf8")).toBe("KEEP NESTED");
    expect(await fs.readFile(view(path.join(name, "unexpected.txt")), "utf8")).toBe("KEEP UNEXPECTED");
  }
  expect(await fs.readFile(sentinel, "utf8")).toBe("KEEP TARGET");
  expect(await fs.readFile(view(`inbox/${temporary}`), "utf8")).toBe("KEEP INBOX");
  expect((await fs.lstat(view(`inbox/${link}`))).isSymbolicLink()).toBe(true);
});
it("repairs and logs permission-only file damage, then keeps the intact file on another rebuild", async () => {
  await seed();
  const relative = "notebook/notebook.md", target = view(relative), before = await fs.readFile(target);
  await fs.chmod(target, 0o666);
  const damaged = await fs.lstat(target);
  await rebuild();
  const repaired = await fs.lstat(target);
  expect(repaired.mode & 0o777).toBe(0o444);
  expect(repaired.ino).not.toBe(damaged.ino);
  expect(await fs.readFile(target)).toEqual(before);
  const log = await fs.readFile(path.join(f.config.storeDir, "view-log.jsonl"), "utf8");
  expect(log.trim().split("\n").map(JSON.parse)).toContainEqual({ event: "tampered", path: relative, at: AT });
  await rebuild();
  expect((await fs.lstat(target)).ino).toBe(repaired.ino);
  expect(await fs.readFile(path.join(f.config.storeDir, "view-log.jsonl"), "utf8")).toBe(log);
});
it("rebuilds a deleted view from the store alone on serve start, before listening", async () => {
  await seed();
  await fs.rm(f.config.viewDir, { recursive: true });
  const start = vi.fn(async () => {
    expect((await readJson(view("notebook/index.json"))).notes).toHaveLength(1);
    expect(await fs.readFile(view("notebook/notebook.md"), "utf8")).toBe("# Fixture\n");
  });
  const { stopInboxTimer } = await serve(f.config, { git: f.git, env: { NOTES_SYNC_TEST: "1", NOTES_SYNC_SKIP_TAILSCALE: "1" },
    serverFactory: () => ({ start }) });
  stopInboxTimer();
  expect(start).toHaveBeenCalledOnce();
});
it("removes only stale expected files or symlinks and preserves all inbox work", async () => {
  await seed();
  const extra = view(`notebook/notes/${"d".repeat(64)}.html`);
  await fs.symlink(f.context.store.file("meta.json"), extra);
  await fs.writeFile(view("notebook/notes/keep-me.txt"), "Unrelated");
  await fs.mkdir(view(`notebook/notes/${"e".repeat(64)}.html`));
  await fs.writeFile(view("inbox/unfinished.txt"), "Draft");
  await fs.writeFile(view("inbox/p-fixture-kept.json"), "{}");
  const next = await f.next([note({ rev: 2, deletedAt: AT, html: '<img data-file="image-1">' })],
    { files: [file()], tombstones: [{ id: "trashed", purgedAt: AT }] });
  expect((await f.request("POST", "/v1/push", next)).status).toBe(200);
  expect(await fs.readdir(view("notebook/images"))).toEqual([]);
  expect(await f.context.store.readObject(f.context.store.published.files["image-1"].sha256)).toEqual(PNG);
  expect((await fs.readdir(view("notebook/notes"))).sort()).toEqual([`${"e".repeat(64)}.html`, "keep-me.txt"].sort());
  expect(await fs.readFile(view("inbox/unfinished.txt"), "utf8")).toBe("Draft");
  expect(await fs.readFile(view("inbox/p-fixture-kept.json"), "utf8")).toBe("{}");
  expect((await readJson(view("notebook/index.json"))).notes).toEqual([]);
});
it("restores edited and symlinked files, logs paths/time without content, leaves backups unchanged", async () => {
  await seed();
  const before = await buildBackup(f.context.store, AT);
  const target = view("notebook/notebook.md");
  await fs.chmod(target, 0o600);
  await fs.writeFile(target, "SENTINEL private edit");
  await fs.unlink(view("notebook/index.json"));
  await fs.symlink(f.context.store.file("meta.json"), view("notebook/index.json"));
  await fs.writeFile(view("inbox/p-fixture-junk.json"), "SENTINEL inbox edit");
  await rebuild();
  expect(await fs.readFile(target, "utf8")).toBe("# Fixture\n");
  expect((await fs.lstat(view("notebook/index.json"))).isSymbolicLink()).toBe(false);
  const log = await fs.readFile(path.join(f.config.storeDir, "view-log.jsonl"), "utf8");
  expect(log).toContain('"path":"notebook/notebook.md"');
  expect(log).toContain('"path":"notebook/index.json"');
  expect(log).not.toContain("SENTINEL");
  expect(await buildBackup(f.context.store, AT)).toEqual(before);
  const markdown = await fs.readFile(target);
  await rebuild();
  expect(await fs.readFile(target)).toEqual(markdown);
});
it.each(["", "notebook", "notebook/notes", "notebook/images", ".claude", "inbox"])(
  "refuses symlinked view directory %s without following it", async (relative) => {
    await seed();
    const sentinel = f.context.store.file("sentinel.txt");
    await fs.writeFile(sentinel, "STORE SENTINEL");
    const linked = view(relative);
    await fs.rm(linked, { recursive: true });
    await fs.symlink(f.context.store.repo, linked);
    await expect(rebuild()).rejects.toThrow("unsafe-directory");
    expect(await fs.readFile(sentinel, "utf8")).toBe("STORE SENTINEL");
    expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await fs.readdir(f.context.store.repo)).not.toContain("index.json");
  });
it("refuses a directory owned by another uid", async () => {
  await seed();
  const original = fs.lstat;
  vi.spyOn(fs, "lstat").mockImplementation(async (filename, ...args) => {
    const stat = await original(filename, ...args);
    if (filename === f.config.viewDir) stat.uid = process.getuid() + 1;
    return stat;
  });
  await expect(rebuild()).rejects.toThrow("unsafe-directory");
});
it("rechecks ancestors before mutation, including a replacement during an operation", async () => {
  await seed();
  await expect(withDirectory(f.config.viewDir, "notebook/notes", async (dir) => {
    await fs.rename(view("notebook"), view("old-notebook"));
    await fs.symlink(f.context.store.repo, view("notebook"));
    await writeInDirectory(dir, `${keyFor("x")}.html`, "untrusted");
  })).rejects.toThrow("unsafe-directory");
  await expect(fs.stat(f.context.store.file(`notes/${keyFor("x")}.html`))).rejects.toHaveProperty("code", "ENOENT");
});
it("can rebuild directly with only store and view paths", async () => {
  await seed();
  await expect(rebuildView({ storeDir: f.config.storeDir, viewDir: f.config.viewDir })).resolves.toBeUndefined();
});

it("removes the retired helper without following a link and recreates a missing inbox", async () => {
  await seed();
  const sentinel = f.context.store.file("sentinel.txt");
  await fs.writeFile(sentinel, "KEEP");
  await fs.symlink(sentinel, view("propose"));
  await fs.rm(view("inbox"), { recursive: true });
  await rebuild();
  expect(await fs.readFile(sentinel, "utf8")).toBe("KEEP");
  expect(await fs.readdir(view(""))).not.toContain("propose");
  expect(await fs.readdir(view("inbox"))).toEqual([]);
});

it("projects kinds and safe titles for every status, with no proposed body in the index or log", async () => {
  await seed();
  const versions = [
    ...["pending", "applied", "kept", "dismissed", "stale", "refused", "superseded"].map((status) => ({ status })),
    { status: "pending", generation: "old-generation" },
    { status: "pending", note: "note-1", title: "Proposed edit" },
    { status: "dismissed", note: "note-1", trash: true },
    { status: "dismissed", note: "trashed", trash: true },
    { status: "applied", note: "absent" },
  ].map((extra, i) => ({ proposal: `p-view-${String(i).padStart(3, "0")}`, hash: "a".repeat(64), sequence: i,
    title: "PRIVATE PROPOSED TITLE", body: "PRIVATE PROPOSED BODY", generation: "generation-A", ingestedAt: AT, ...extra }));
  for (const record of versions) await writeJson(f.context.store.file(`proposals/${proposalFilename(record.proposal, record.hash)}`), record);
  await rebuild();
  const index = await readJson(view("notebook/proposals.json"));
  expect(index.map((p) => [p.kind, p.title])).toEqual([
    ["new", "PRIVATE PROPOSED TITLE"], ...Array.from({ length: 7 }, () => ["new", "New note"]),
    ["edit", "Fixture title"], ["trash", "Fixture title"], ["trash", ""], ["edit", ""],
  ]);
  expect(index.every((p) => !Object.hasOwn(p, "body"))).toBe(true);
  const log = await fs.readFile(view("notebook/proposals-log.md"), "utf8");
  expect(log).toContain("new note: New note · kept");
  expect(log).toContain("to Trash: Fixture title · dismissed");
  expect(log).toContain("to Trash: (note unavailable) · dismissed");
  expect(log).not.toContain("PRIVATE PROPOSED");
});
it.each([0, 50, 51, 501])("shows at most 50 of %i applied ticks in the readable log, keeping all ticks in the index", async (count) => {
  await seed();
  const applied = Array.from({ length: count }, (_, i) => `tick-${i + 1}`);
  const record = { proposal: "p-log-fixture", hash: "a".repeat(64), note: "note-1", status: "applied",
    ingestedAt: AT, sequence: 1, outcome: { outcome: "applied", applied, at: AT } };
  await writeJson(f.context.store.file(`proposals/${proposalFilename(record.proposal, record.hash)}`), record);
  await rebuild();
  const ticks = applied.slice(0, 50).join(", ") || "none";
  expect(await fs.readFile(view("notebook/proposals-log.md"), "utf8")).toBe(
    `# Proposal outcomes\n\n- ${AT} · Fixture title · applied · applied: ${ticks}${count > 50 ? `, and ${count - 50} more` : ""}\n`);
  expect((await readJson(view("notebook/proposals.json")))[0].outcome.applied).toEqual(applied);
});
it("hides handled new-note titles through Apply, Trash and purge, including a competing revision", async () => {
  await seed();
  const submit = async (title) => {
    await fs.writeFile(view("inbox/p-new-view.html"), "<p>New fixture text</p>");
    await fs.writeFile(view("inbox/p-new-view.json"), JSON.stringify({ generation: "generation-A", title,
      folderId: null, tags: [], why: "Fixture" }));
    await f.request("GET", "/v1/state?proposals=2");
    return (await f.request("GET", "/v1/state?proposals=2")).body.proposals[0];
  };
  const first = await submit("First private title");
  await submit("Competing private title");
  expect((await readJson(view("notebook/proposals.json"))).map((p) => [p.status, p.title])).toEqual([
    ["superseded", "New note"], ["pending", "Competing private title"],
  ]);
  expect((await f.request("POST", "/v1/outcomes", [{ proposal: first.proposal, hash: first.hash, outcome: "applied", at: AT }])).status).toBe(200);
  const original = structuredClone(f.context.store.published.notes);
  for (const deletedAt of [null, AT, "purged"]) {
    const rows = deletedAt === "purged" ? original : [...original, note({ id: "created-note", title: "First private title",
      deletedAt, rev: deletedAt === null ? 1 : 2 })];
    expect((await f.request("POST", "/v1/push", await f.next(rows, { folders: f.context.store.published.folders,
      files: [file()], tombstones: deletedAt === "purged" ? [{ id: "created-note", purgedAt: AT }] : [] }))).status).toBe(200);
    const index = await readJson(view("notebook/proposals.json"));
    expect(index.map((p) => [p.kind, p.status, p.title])).toEqual([["new", "applied", "New note"], ["new", "superseded", "New note"]]);
    expect(await fs.readFile(view("notebook/proposals-log.md"), "utf8")).not.toContain("private title");
  }
});
it("hides a pending new-note title when a push replaces the notebook generation", async () => {
  expect((await f.request("POST", "/v1/push", push())).status).toBe(200);
  await fs.writeFile(view("inbox/p-old-generation.html"), "<p>Private fixture</p>");
  await fs.writeFile(view("inbox/p-old-generation.json"), JSON.stringify({ generation: "generation-A", title: "Old private title",
    folderId: null, tags: [], why: "Fixture" }));
  await f.request("GET", "/v1/state?proposals=2"); await f.request("GET", "/v1/state?proposals=2");
  expect((await readJson(view("notebook/proposals.json")))[0].title).toBe("Old private title");
  expect((await f.request("POST", "/v1/push", await f.next([note()], { generation: "generation-B" }))).status).toBe(200);
  expect((await readJson(view("notebook/proposals.json")))[0]).toMatchObject({ kind: "new", status: "pending", title: "New note" });
  expect(await fs.readFile(view("notebook/proposals-log.md"), "utf8")).not.toContain("Old private title");
});
it("gives a version refused for its shape no kind, since it was stored without details", async () => {
  await seed();
  await fs.writeFile(view("inbox/p-bad-tags.html"), "<p>Fixture</p>");
  await fs.writeFile(view("inbox/p-bad-tags.json"), JSON.stringify({ note: "note-1", basedOnRev: 1, generation: "generation-A",
    title: "Fixture title", folderId: null, tags: [" untrimmed"], why: "Fixture" }));
  await f.request("GET", "/v1/state?proposals=2"); await f.request("GET", "/v1/state?proposals=2");
  const [entry] = await readJson(view("notebook/proposals.json"));
  expect(entry).toMatchObject({ proposal: "p-bad-tags", status: "refused", reason: "invalid-tags", title: "" });
  expect(Object.hasOwn(entry, "kind")).toBe(false);
});
