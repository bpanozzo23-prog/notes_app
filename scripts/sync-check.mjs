// Server-only smoke check. Claude runs this explicitly; Vitest never opens its sockets.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { keyFor, readJson, sha256 } from "../server/fsutil.mjs";
import { EXPORTED_PREFS, extractFileIds } from "../server/constants.mjs";
import { IMAGE_EXT } from "../server/view.mjs";
import { openStore } from "../server/store.mjs";

const run = promisify(execFile);
const MAIN = fileURLToPath(new URL("../server/main.mjs", import.meta.url));
const HELPER = fileURLToPath(new URL("../server/propose.mjs", import.meta.url));
export function samplePush(sample, state, generation, rows = sample.notes) {
  // Fixture-only projection until 4b adds the app's deterministic view export.
  const live = sample.notes.filter((n) => n.deletedAt === null);
  const notebookMd = "# Sample notebook\n\n" + live.map((n) =>
    `## ${n.title || "(untitled)"}\nId: ${n.id} · Edited: ${n.updatedAt}\n\n${n.text}\n`).join("\n");
  return { base: { round: state.round, generation: state.generation }, generation,
    schemaVersion: sample.schemaVersion, appVersion: sample.appVersion,
    ids: sample.notes.map(({ id, rev }) => ({ id, rev })), rows,
    folders: sample.folders, tombstones: sample.tombstones, preferences: Object.fromEntries(
      EXPORTED_PREFS.filter((k) => Object.hasOwn(sample.preferences, k)).map((k) => [k, sample.preferences[k]])),
    files: sample.files.map(({ data: _data, ...metadata }) => metadata), notebookMd };
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
export async function syncCheck(args = process.argv.slice(2), print = (s) => process.stdout.write(`${s}\n`)) {
  if (args.length && !(args.length === 2 && args[0] === "--origin")) throw new Error("usage: sync-check [--origin http://127.0.0.1:5174]");
  const origin = args[1] ?? "http://127.0.0.1:5174";
  const originUrl = new URL(origin);
  if (!["http:", "https:"].includes(originUrl.protocol) || originUrl.origin !== origin) throw new Error("invalid-test-origin");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "notes-sync-check-"));
  let child, exited, token, passed = 0;
  const pass = (label) => { passed++; print(`PASS ${label}`); };
  try {
    const port = await freePort();
    const config = { origin, hosts: [`127.0.0.1:${port}`], listen: "127.0.0.1", port, home: root,
      storeDir: path.join(root, "store-root"), configDir: path.join(root, "config"), viewDir: path.join(root, "view"),
      libDir: path.join(root, "lib") };
    await fs.mkdir(config.configDir, { mode: 0o700 });
    const configFile = path.join(config.configDir, "config.json");
    await fs.writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    const env = { ...process.env, NOTES_SYNC_CONFIG: configFile, NOTES_SYNC_TEST: "1", NOTES_SYNC_SKIP_TAILSCALE: "1" };
    delete env.NOTES_SYNC_TEST_CRASH_AFTER;
    const request = async (method, endpoint, body, expected = 200) => {
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
        method, signal: AbortSignal.timeout(10000), headers: { Origin: origin,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json" }) },
        ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
      });
      assert.equal(response.status, expected, `${method} ${endpoint.split("?")[0]} status`);
      return response.json();
    };
    const start = async (crashAfter) => {
      child = spawn(process.execPath, [MAIN, "serve"], { env: { ...env,
        ...(crashAfter ? { NOTES_SYNC_TEST_CRASH_AFTER: crashAfter } : {}) }, stdio: "ignore" });
      exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error("service-exited-at-start");
        try { await request("GET", "/v1/state", undefined, token ? 200 : 401); return; }
        catch { await delay(50); }
      }
      throw new Error("service-start-timeout");
    };
    const stop = async () => {
      if (child && child.exitCode === null) child.kill("SIGTERM");
      if (exited) await exited;
      child = null; exited = null;
    };
    await run(process.execPath, [MAIN, "init-store"], { env });
    await start();
    const { stdout } = await run(process.execPath, [MAIN, "pair"], { env });
    const paired = await request("POST", "/v1/pair", { code: stdout.trim().split(" ")[0], label: "Sample smoke check" });
    token = paired.token;
    assert.equal((await request("GET", "/v1/state")).fullPush, true);
    pass("temporary service and pairing");
    const sample = JSON.parse(await fs.readFile(new URL("../public/sample-notebook.json", import.meta.url), "utf8"));
    let generation = "sample-generation-A";
    const upload = async () => {
      for (const file of sample.files) {
        const bytes = Buffer.from(file.data, "base64");
        const result = await request("PUT", `/v1/files/${encodeURIComponent(file.id)}?generation=${encodeURIComponent(generation)}`, bytes);
        assert.equal(result.sha256, sha256(bytes));
      }
    };
    const verify = async () => {
      const state = await request("GET", "/v1/state");
      assert.equal(state.counts.notes, sample.notes.length);
      const live = sample.notes.filter((n) => n.deletedAt === null);
      assert.equal(state.counts.live, live.length);
      assert.equal(state.counts.folders, sample.folders.length);
      assert.equal(state.counts.images, sample.files.length);
      assert.deepEqual(state.missingImages, []);
      const store = await openStore(config.storeDir);
      for (const n of sample.notes) {
        const stored = await readJson(store.file(`notes/${keyFor(n.id)}.json`));
        assert.equal(sha256(stored.html), sha256(n.html));
        assert.equal(stored.rev, n.rev);
      }
      const index = await readJson(path.join(config.viewDir, "notebook/index.json"));
      assert.equal(index.notes.length, live.length);
      assert.equal(index.generation, generation);
      assert.equal(index.round, state.round);
      assert.equal((await fs.readdir(path.join(config.viewDir, "notebook/notes"))).length, live.length);
      for (const n of live) assert.equal(sha256(await fs.readFile(path.join(config.viewDir, `notebook/notes/${keyFor(n.id)}.html`))), sha256(n.html));
      const liveImages = new Set(live.flatMap((n) => extractFileIds(n.html)));
      for (const file of sample.files) {
        assert.equal(store.published.files[file.id].sha256, sha256(Buffer.from(file.data, "base64")));
        if (liveImages.has(file.id)) assert.equal(sha256(await fs.readFile(path.join(config.viewDir,
          `notebook/images/${keyFor(file.id)}.${IMAGE_EXT[file.type]}`))), sha256(Buffer.from(file.data, "base64")));
      }
      return state;
    };
    await upload();
    await request("POST", "/v1/push", samplePush(sample, await request("GET", "/v1/state"), generation));
    await verify();
    pass("sample push, store and view counts and hashes");
    const edited = sample.notes.find((n) => n.deletedAt === null);
    edited.rev++; edited.html += "<p>Smoke check edit.</p>"; edited.text += "\nSmoke check edit.";
    await request("POST", "/v1/push", samplePush(sample, await request("GET", "/v1/state"), generation, [edited]));
    await verify();
    pass("incremental note edit");
    const helper = (args) => run(process.execPath, [HELPER, ...args], { cwd: config.viewDir, env: { ...env, NOTES_VIEW: config.viewDir } });
    await helper(["draft", edited.id]);
    const bodyPath = path.join(config.viewDir, `inbox/drafts/${keyFor(edited.id)}/body.html`);
    await fs.appendFile(bodyPath, "<p>Proposed fixture addition.</p>");
    await helper(["check", edited.id]);
    await helper(["submit", edited.id]);
    const proposal = (await request("GET", "/v1/state")).proposals[0];
    assert.equal(proposal.note, edited.id);
    assert.ok(proposal.body.includes("Proposed fixture addition."));
    await request("POST", "/v1/outcomes", [{ proposal: proposal.proposal, hash: proposal.hash,
      outcome: "applied", applied: ["body"], at: new Date().toISOString() }]);
    const handled = await readJson(path.join(config.viewDir, "notebook/proposals.json"));
    assert.equal(handled.find((p) => p.hash === proposal.hash).status, "applied");
    await helper(["list"]);
    assert.equal((await fs.readdir(path.join(config.viewDir, "inbox/pending"))).length, 0);
    pass("helper submission, ingestion and reported outcome");
    generation = "sample-generation-B";
    edited.title += " (imported)";
    await upload();
    const imported = samplePush(sample, await request("GET", "/v1/state"), generation);
    const ask = await request("POST", "/v1/push", imported, 409);
    assert.equal(ask.error, "confirm");
    await request("POST", "/v1/push", { ...imported, confirm: ask.confirm });
    await verify();
    pass("import confirmation");
    const backup = await request("GET", "/v1/backup");
    assert.equal(backup.format, "notes_app-backup");
    for (const key of ["notes", "folders", "files", "tombstones"]) assert.equal(backup[key].length, sample[key].length);
    for (const file of backup.files) assert.equal(sha256(Buffer.from(file.data, "base64")),
      sha256(Buffer.from(sample.files.find((f) => f.id === file.id).data, "base64")));
    pass("backup envelope and image hashes");
    for (const step of ["apply", "publish"]) {
      const before = await request("GET", "/v1/state");
      await stop(); await start(step);
      edited.rev++; edited.html += `<p>Crash fixture ${step}.</p>`;
      const body = samplePush(sample, before, generation, [edited]);
      const crashed = exited;
      await assert.rejects(request("POST", "/v1/push", body));
      assert.equal(await Promise.race([crashed, delay(10000, undefined, { ref: false }).then(() => { throw new Error("crash-timeout"); })]), 86);
      assert.equal((await readJson(path.join(config.storeDir, "journal.json"))).step, step);
      child = null; exited = null;
      await start();
      const after = await verify();
      assert.equal(after.round, before.round + 1);
      await assert.rejects(fs.stat(path.join(config.storeDir, "journal.json")), { code: "ENOENT" });
      pass(`journal recovery after ${step}`);
    }
    await stop();
    print(`PASS ${passed}/${passed} server checks; no browser or live service used.`);
  } catch (error) {
    print(`FAIL after ${passed} checks (${error.code ?? error.name}); temporary service stopped.`);
    throw error;
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    if (exited) await exited.catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncCheck().catch(() => { process.exitCode = 1; });
}
