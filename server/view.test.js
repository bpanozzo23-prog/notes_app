// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { AT, PNG, fixture, note, file, push } from "./test-support.js";
import { keyFor, readJson, sha256 } from "./fsutil.mjs";
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
    expect((await fs.stat(view(name))).mode & 0o777).toBe(0o755);
  }
  expect(await fs.readdir(view("notebook/notes"))).toEqual([`${keyFor("note-1")}.html`]);
  expect(await fs.readdir(view("inbox"))).toEqual([]);
  expect(await fs.readdir(view(""))).not.toContain("propose");
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
