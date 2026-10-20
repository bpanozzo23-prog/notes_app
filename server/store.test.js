// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixture, note, push, PNG } from "./test-support.js";
import { atomicWrite, keyFor, readJson, removeTemps, sha256, stableStringify, TEMP_PREFIX, writeJson } from "./fsutil.mjs";
import { createGit, initStore, openStore } from "./store.mjs";
import { createQueue } from "./queue.mjs";

let f;
beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f?.clean(); });
it("hashes all ids, even an id mimicking another key, Unicode, and 512 characters", async () => {
  const ids = ["plain", keyFor("plain"), "x".repeat(512), "你好 / mañana 🍊", "__proto__", "constructor", "../../escape"];
  expect((await f.request("POST", "/v1/push", push(ids.map((id) => note({ id }))))).status).toBe(200);
  const names = await fs.readdir(f.context.store.file("notes"));
  expect(new Set(names).size).toBe(ids.length);
  for (const id of ids) {
    expect(keyFor(id)).toMatch(/^[a-f0-9]{64}$/);
    expect(await readJson(f.context.store.file(`notes/${keyFor(id)}.json`))).toHaveProperty("id", id);
  }
  await f.restart();
  const state = await f.request("GET", "/v1/state");
  expect(Object.keys(state.body.notes).sort()).toEqual(ids.sort());
  expect(state.body.notes.__proto__).toBe(1);
});
it("refuses mismatched note filenames instead of accepting the wrong row", async () => {
  await f.request("POST", "/v1/push", push());
  await writeJson(f.context.store.file(`notes/${keyFor("note-1")}.json`), note({ id: "different" }));
  await expect(openStore(f.config.storeDir, { git: f.git })).rejects.toThrow("note-key-mismatch");
});
it("refuses distinct ids with the same UTF-8 key before anything is published", async () => {
  expect(keyFor("\ud800")).toBe(keyFor("\ufffd"));
  const response = await f.request("POST", "/v1/push", push([note({ id: "\ud800" }), note({ id: "\ufffd" })]));
  expect(response.body.error).toBe("id-key-collision");
  expect(f.context.store.state().round).toBe(0);
  expect(await fs.readdir(f.context.store.file("notes"))).toEqual([]);
});
it("writes with private modes, replaces atomically, and never replaces an immutable object", async () => {
  for (const dir of [f.config.storeDir, f.context.store.repo, f.context.store.objects, f.context.store.backups, f.context.store.file("notes"), f.context.store.file("proposals")]) {
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  }
  const filename = path.join(f.root, "atomic");
  await atomicWrite(filename, "old");
  await atomicWrite(filename, "new");
  expect(await fs.readFile(filename, "utf8")).toBe("new");
  expect((await fs.stat(filename)).mode & 0o777).toBe(0o600);
  const hash = await f.context.store.putObject(PNG);
  const first = await fs.stat(path.join(f.context.store.objects, hash));
  await f.context.store.putObject(PNG);
  expect((await fs.stat(path.join(f.context.store.objects, hash))).ino).toBe(first.ino);
  expect(hash).toBe(sha256(PNG));
  expect((await fs.readdir(f.context.store.objects))).toEqual([hash]);
});
it("treats corrupt objects as missing and refuses invalid object paths", async () => {
  const hash = await f.context.store.putObject(PNG);
  await fs.writeFile(path.join(f.context.store.objects, hash), "damaged fixture");
  expect(await f.context.store.readObject(hash)).toBeNull();
  await expect(f.context.store.readObject("../../escape")).rejects.toThrow("invalid-object-hash");
});
it("removes only our leftover temporary files, without following symlinks", async () => {
  const temporary = f.context.store.file(`notes/${TEMP_PREFIX}fixture`);
  await fs.writeFile(temporary, "partial");
  const unrelated = f.context.store.file("keep.tmp");
  await fs.writeFile(unrelated, "keep");
  const outside = path.join(f.root, `${TEMP_PREFIX}outside`);
  await fs.writeFile(outside, "keep");
  await fs.symlink(f.root, path.join(f.context.store.objects, "outside-link"));
  await removeTemps(f.config.storeDir);
  await expect(fs.stat(temporary)).rejects.toHaveProperty("code", "ENOENT");
  expect(await fs.readFile(unrelated, "utf8")).toBe("keep");
  expect(await fs.readFile(outside, "utf8")).toBe("keep");
});
it("sorts keys recursively including numeric-looking keys and preserves hostile keys", () => {
  expect(stableStringify(JSON.parse('{"z":1,"10":2,"2":3,"__proto__":{"z":1,"a":2},"a":[{"b":0,"a":1}]}')))
    .toBe('{"10":2,"2":3,"__proto__":{"a":2,"z":1},"a":[{"a":1,"b":0}],"z":1}');
});
it("does not interpret malformed JSON as a missing file", async () => {
  const filename = path.join(f.root, "invalid.json");
  expect(await readJson(filename, null)).toBeNull();
  await fs.writeFile(filename, "bad");
  await expect(readJson(filename, null)).rejects.toThrow();
});
it("keeps the mutation queue usable after a rejection", async () => {
  const queue = createQueue(), order = [];
  const first = queue(async () => { order.push(1); throw new Error("fixture"); });
  const second = queue(async () => { order.push(2); return 2; });
  await expect(first).rejects.toThrow("fixture");
  expect(await second).toBe(2);
  expect(order).toEqual([1, 2]);
});
it("uses the real git adapter only in a temporary fixture repository; clean commits succeed", async () => {
  const store = await initStore(path.join(f.root, "real-git"));
  expect(await store.git.hasRemote()).toBe(false);
  await store.git.commit("round 0: 0 notes written, 0 removed");
  await store.git.commit("round 0: 0 notes written, 0 removed");
  const run = promisify(execFile);
  const git = (args) => run("git", args, { cwd: store.repo });
  expect((await git(["config", "--local", "user.name"])).stdout.trim()).toBe("notes-sync");
  expect((await git(["config", "--local", "user.email"])).stdout.trim()).toBe("notes-sync@localhost");
  expect((await git(["config", "--local", "core.fsync"])).stdout.trim()).toBe("committed");
  expect((await git(["rev-list", "--count", "HEAD"])).stdout.trim()).toBe("1");
  await git(["remote", "add", "fixture", path.join(f.root, "unused-remote")]); // Local config only, no connection.
  expect(await store.git.hasRemote()).toBe(true);
});
it("never mistakes an add/diff/commit failure for nothing-to-commit", async () => {
  const run = vi.fn(async (_program, args) => {
    if (args[0] === "diff") throw Object.assign(new Error("diff failed"), { code: 128 });
    return { stdout: "" };
  });
  await expect(createGit(f.root, run).commit("round 1: 1 notes written, 0 removed")).rejects.toThrow("diff failed");
  run.mockImplementation(async (_program, args) => {
    if (args[0] === "diff") throw Object.assign(new Error("changed"), { code: 1 });
    if (args[0] === "commit") throw new Error("commit failed");
    return { stdout: "" };
  });
  await expect(createGit(f.root, run).commit("round 1: 1 notes written, 0 removed")).rejects.toThrow("commit failed");
});
it("refuses to initialise over a damaged store", async () => {
  await fs.unlink(f.context.store.file("meta.json"));
  await expect(initStore(f.config.storeDir, { git: f.git })).rejects.toThrow("store-not-empty");
});
