// Server smoke checks followed by the browser sync checks. Claude runs this explicitly;
// Vitest imports only samplePush and never opens sockets or launches a browser.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { isEntryPoint, keyFor, readJson, sha256 } from "../server/fsutil.mjs";
import { EXPORTED_PREFS, extractFileIds } from "../server/constants.mjs";
import { IMAGE_EXT } from "../server/view.mjs";
import { openStore } from "../server/store.mjs";
import { guardTailnet } from "./tailnet-guard.mjs";
import { makePng } from "./image-fixture.mjs";
import { acceptImport, backFromScreen, button, changedSample, checkPreview, confirmation, importNotebook, until, unreachable, waitSynced } from "./sync-browser-fixtures.mjs";

const run = promisify(execFile);
const MAIN = fileURLToPath(new URL("../server/main.mjs", import.meta.url));
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
  const serverOnly = args.includes("--server-only");
  args = args.filter((arg) => arg !== "--server-only");
  if (args.length && !(args.length === 2 && args[0] === "--origin")) throw new Error("usage: sync-check [--server-only] [--origin http://127.0.0.1:5174]");
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
    const submit = async (pid, extra = {}) => {
      const { body, ...details } = { note: edited.id, basedOnRev: edited.rev, generation,
        title: edited.title, folderId: edited.folderId, tags: edited.tags, why: "Fixture check",
        body: `${edited.html}<p>Proposed fixture addition.</p>`, ...extra };
      await fs.writeFile(path.join(config.viewDir, `inbox/${pid}.html`), body);
      await fs.writeFile(path.join(config.viewDir, `inbox/${pid}.json`), JSON.stringify(details));
      // Poll only the view: this also proves the timer works without a phone state request.
      for (let i = 0; i < 80; i++) {
        const recorded = (await readJson(path.join(config.viewDir, "notebook/proposals.json"))).find((p) => p.proposal === pid);
        if (recorded) {
          // Publication precedes cleanup, so wait for both files to disappear as well.
          const names = await fs.readdir(path.join(config.viewDir, "inbox"));
          if (!names.includes(`${pid}.html`) && !names.includes(`${pid}.json`)) return recorded;
        }
        await delay(100);
      }
      throw new Error("proposal-ingestion-timeout");
    };
    assert.equal((await submit("p-fixture-first")).status, "pending");
    const proposal = (await request("GET", "/v1/state")).proposals.find((p) => p.proposal === "p-fixture-first");
    assert.equal(proposal.note, edited.id);
    assert.ok(proposal.body.includes("Proposed fixture addition."));
    await request("POST", "/v1/outcomes", [{ proposal: proposal.proposal, hash: proposal.hash,
      outcome: "applied", applied: ["body"], at: new Date().toISOString() }]);
    const handled = await readJson(path.join(config.viewDir, "notebook/proposals.json"));
    assert.equal(handled.find((p) => p.hash === proposal.hash).status, "applied");
    assert.equal((await fs.readdir(path.join(config.viewDir, "inbox"))).length, 0);
    pass("file pair ingestion by timer and reported outcome");
    const refused = await submit("p-fixture-stale", { basedOnRev: edited.rev + 1 });
    assert.equal(refused.status, "refused");
    assert.equal(refused.reason, "changed-since-read");
    assert.ok(!Object.hasOwn(refused, "body"));
    pass("changed-since-read refusal");
    assert.equal((await submit("p-fixture-replaced")).status, "pending");
    assert.equal((await submit("p-fixture-replacement", { title: "Replacement fixture" })).status, "pending");
    const superseded = await readJson(path.join(config.viewDir, "notebook/proposals.json"));
    assert.equal(superseded.find((p) => p.proposal === "p-fixture-replaced").status, "superseded");
    assert.equal(superseded.filter((p) => p.status === "pending").length, 1);
    pass("new valid proposal supersedes the pending proposal for its note");
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
    print(`PASS ${passed}/${passed} server checks; temporary loopback service only.`);
  } catch (error) {
    print(`FAIL after ${passed} checks (${error.code ?? error.name}); temporary service stopped.`);
    throw error;
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    if (exited) await exited.catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
  if (!serverOnly) await browserSyncCheck(print);
}

// Build once and serve only the generated files, following browser-checks.mjs. Keeping dist
// inside this run's temporary directory also makes a failed check leave no build fixtures.
async function serveBuild(dist) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    const file = path.resolve(dist, pathname.replace(/^\/notes_app\//, "") || "index.html");
    if (!["GET", "HEAD"].includes(req.method) || !pathname.startsWith("/notes_app/") ||
        !file.startsWith(dist + path.sep)) { res.writeHead(404).end(); return; }
    try {
      const bytes = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return server;
  } catch (error) { server.close(); throw error; }
}

export async function browserSyncCheck(print = console.log) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "notes-sync-browser-"));
  let appServer, browser, context, child, exited, assertNoTailnet, closing = false, crashing = false;
  let nextHold = null, activeCheck = "build and temporary service", passed = 0;
  const holds = new Set(), routeJobs = new Set(), routeErrors = [], unexpected = [], pushes = [];
  const pass = (label) => { passed++; print(`PASS browser: ${label}`); };
  // No rejection is left unhandled if a child fails to spawn. Every waiter has a deadline.
  const stop = async () => {
    if (!child) return;
    const processToStop = child, done = exited;
    if (processToStop.exitCode === null && processToStop.signalCode === null) processToStop.kill("SIGTERM");
    if (!await Promise.race([done.then(() => true), delay(2000, false, { ref: false })])) {
      processToStop.kill("SIGKILL");
      await done;
    }
    child = null; exited = null;
  };
  try {
    // Lazy imports: the server-only check and unit tests do not load browser/build tooling.
    const [{ build }, { chromium, devices }] = await Promise.all([import("vite"), import("playwright")]);
    const project = fileURLToPath(new URL("..", import.meta.url)), dist = path.join(root, "dist");
    await build({ root: project, configFile: path.join(project, "vite.config.js"), logLevel: "error",
      build: { outDir: dist, emptyOutDir: true } });
    appServer = await serveBuild(dist);
    const origin = `http://127.0.0.1:${appServer.address().port}`, url = `${origin}/notes_app/`;
    const port = await freePort(), address = `http://127.0.0.1:${port}`;
    const config = { origin, hosts: [`127.0.0.1:${port}`], listen: "127.0.0.1", port, home: root,
      storeDir: path.join(root, "private"), configDir: path.join(root, "config"),
      viewDir: path.join(root, "view"), libDir: path.join(root, "lib") };
    await fs.mkdir(config.configDir, { mode: 0o700 });
    const configFile = path.join(config.configDir, "config.json");
    await fs.writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    // main.mjs status probes the tailscale CLI even in test mode. Shadow it for this child
    // environment only, so status cannot inspect the real machine's Serve/Funnel settings.
    const bin = path.join(root, "bin");
    await fs.mkdir(bin, { mode: 0o700 });
    await fs.writeFile(path.join(bin, "tailscale"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      NOTES_SYNC_CONFIG: configFile, NOTES_SYNC_TEST: "1", NOTES_SYNC_SKIP_TAILSCALE: "1" };
    delete env.NOTES_SYNC_TEST_CRASH_AFTER;
    const cli = async (command) => (await run(process.execPath, [MAIN, command], { env, timeout: 10_000 })).stdout.trim();
    const status = async () => JSON.parse(await cli("status"));
    const start = async (crashAfter) => {
      child = spawn(process.execPath, [MAIN, "serve"], { env: { ...env,
        ...(crashAfter ? { NOTES_SYNC_TEST_CRASH_AFTER: crashAfter } : {}) }, stdio: "ignore" });
      exited = new Promise((resolve) => {
        child.once("error", () => resolve({ spawnError: true }));
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      await until("loopback service start", async () => {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("service-exited-at-start");
        try {
          const response = await fetch(`${address}/v1/state`, { headers: { Origin: origin },
            signal: AbortSignal.timeout(500), redirect: "error" });
          await response.arrayBuffer();
          return response.status === 401;
        } catch { return false; }
      }, Boolean);
    };
    await cli("init-store"); await start();
    const sample = JSON.parse(await fs.readFile(new URL("../public/sample-notebook.json", import.meta.url), "utf8"));
    browser = await chromium.launch();
    context = await browser.newContext({ ...devices["Pixel 7"], locale: "en-GB", serviceWorkers: "block" });
    assertNoTailnet = await guardTailnet(context);
    await context.grantPermissions(["local-network-access"], { origin });
    await context.route("https://api.anthropic.com/**", async (route) => {
      unexpected.push("Anthropic request"); await route.abort();
    });

    // Hold a real service response, after the server processed the request. Fetching uses
    // loopback sockets; no API responses are fabricated and no credentials are recorded.
    const holdNext = (matches) => {
      assert.equal(nextHold, null, "only one pending response hold");
      let enter, release, finish;
      const hold = { matches, entered: new Promise((resolve) => { enter = resolve; }),
        released: new Promise((resolve) => { release = resolve; }),
        finished: new Promise((resolve) => { finish = resolve; }),
        enter, release, finish };
      nextHold = hold; holds.add(hold);
      return hold;
    };
    const waitHeld = (hold) => Promise.race([hold.entered, delay(15_000, undefined, { ref: false }).then(() => { throw new Error("response-hold-timeout"); })]);
    await context.route(`${address}/**`, async (route) => {
      const job = (async () => {
        const request = route.request(), target = new URL(request.url()), method = request.method();
        const hold = nextHold?.matches(method, target.pathname) ? nextHold : null;
        if (hold) nextHold = null;
        const pushed = method === "POST" && target.pathname === "/v1/push" ? request.postDataJSON() : null;
        // Retain only fixture pushes and their result; never pair replies or auth headers.
        const record = pushed ? { body: pushed, status: null } : null;
        if (record) pushes.push(record);
        try {
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15_000 });
          if (record) record.status = response.status();
          if (hold) {
            hold.request = { method, path: target.pathname, generation: target.searchParams.get("generation") };
            hold.responseStatus = response.status();
            hold.enter(); await hold.released;
          }
          try { await route.fulfill({ response }); }
          finally { await response.dispose(); }
        } catch {
          // Aborted held requests and the intentional crash are expected. Other routing
          // failures must fail the check instead of becoming a plausible UI error message.
          if (!hold && !crashing && !closing) routeErrors.push(`${method} ${target.pathname}`);
          await route.abort().catch(() => {});
        } finally {
          if (hold) { hold.finish(); holds.delete(hold); }
        }
      })();
      routeJobs.add(job);
      try { await job; }
      catch {
        if (!closing) routeErrors.push("service route setup failed");
        await route.abort().catch(() => {});
      } finally { routeJobs.delete(job); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const back = () => backFromScreen(page);
    const openSync = () => page.getByRole("button", { name: /^Sync · (Off|Connected)$/ }).click();
    const pair = async () => {
      await page.getByLabel("Address", { exact: true }).fill(address);
      const code = (await cli("pair")).split(" ")[0];
      assert.match(code, /^\d{6}$/);
      await page.getByLabel("Code", { exact: true }).fill(code);
      await button(page, "Connect").click();
    };
    const nextRound = (after, timeout = 75_000) => until("next published browser round", status,
      (value) => value.round > after && !value.journalPending, timeout);
    const storeSnapshot = async () => (await openStore(config.storeDir)).published;
    const verifyCopy = async (backup) => {
      const store = await openStore(config.storeDir);
      assert.equal(store.published.notes.length, backup.notes.length);
      assert.deepEqual(store.published.notes.map((n) => n.id).sort(), backup.notes.map((n) => n.id).sort());
      for (const note of backup.notes) {
        // Read by the actual key, never by an assumed title or a directory position.
        const row = await readJson(store.file(`notes/${keyFor(note.id)}.json`));
        assert.equal(row.html, note.html);
        assert.equal(row.title, note.title);
        assert.equal(row.rev, note.rev);
      }
      assert.deepEqual(store.published.folders, backup.folders);
      assert.deepEqual(store.published.tombstones, backup.tombstones);
      assert.equal(Object.keys(store.published.files).length, backup.files.length);
      for (const file of backup.files) {
        const hash = sha256(Buffer.from(file.data, "base64"));
        assert.equal(store.published.files[file.id].sha256, hash);
        assert.equal(sha256(await fs.readFile(path.join(store.objects, hash))), hash);
      }
      const view = await readJson(path.join(config.viewDir, "notebook/index.json"));
      const live = backup.notes.filter((n) => n.deletedAt === null);
      assert.equal(view.notes.length, live.length);
      assert.equal(view.round, store.published.meta.round);
      for (const note of live) assert.equal(sha256(await fs.readFile(
        path.join(config.viewDir, `notebook/notes/${keyFor(note.id)}.html`))), sha256(note.html));
      return store.published;
    };
    const assertHealthy = () => {
      assertNoTailnet(); assert.deepEqual(unexpected, []); assert.deepEqual(routeErrors, []);
    };
    await page.goto(url, { waitUntil: "networkidle" });
    await button(page, "Settings").click(); await importNotebook(page, sample); await openSync(); await pair();
    const first = await nextRound(0);
    assert.deepEqual(first.counts, { notes: sample.notes.length, live: sample.notes.filter((n) => n.deletedAt === null).length,
      trashed: sample.notes.filter((n) => n.deletedAt !== null).length, folders: sample.folders.length, images: sample.files.length });
    await waitSynced(page, sample); await verifyCopy(sample); assertHealthy();
    pass("pairing, first round, sample counts and store/view hashes");

    activeCheck = "editor save triggers a round within 75 seconds";
    const { backup: modified, edited } = changedSample(sample);
    await back(); await back(); await button(page, edited.title).click();
    const editor = page.getByLabel("Note body", { exact: true });
    await editor.click(); await editor.press("Control+End"); await editor.press("End");
    await editor.pressSequentially(" Browser sync typing fixture.");
    // No Sync now or navigation here: this must be the actual autosave/change scheduler.
    const typedRound = await nextRound(first.round);
    const typed = await readJson(path.join(config.storeDir, `store/notes/${keyFor(edited.id)}.json`));
    assert.ok(typed.html.includes("Browser sync typing fixture."));
    assert.ok(typed.rev > sample.notes.find((n) => n.id === edited.id).rev);
    pass("typed editor content reached its keyed store file within 75 seconds");

    activeCheck = "import confirmation";
    await back(); await button(page, "Settings").click(); await importNotebook(page, modified); await openSync();
    await confirmation(page).waitFor();
    await page.getByRole("heading", { name: "1 note would be removed", exact: true }).waitFor();
    await page.getByRole("heading", { name: "1 note would be replaced", exact: true }).waitFor();
    assert.equal((await status()).round, typedRound.round);
    await button(page, "Replace the XPS copy").click();
    const replaced = await nextRound(typedRound.round);
    await waitSynced(page, modified); await verifyCopy(modified); assertHealthy();
    pass("import asks for exactly 1 changed and 1 removed; Replace publishes the copy");

    activeCheck = "restore preview and full push";
    const beforeRestore = await storeSnapshot(), restorePushIndex = pushes.length;
    await button(page, "Restore from the XPS…").click(); await checkPreview(page, modified);
    await acceptImport(page);
    const restored = await nextRound(replaced.round);
    await waitSynced(page, modified);
    assert.equal(await confirmation(page).count(), 0);
    const restorePush = pushes.slice(restorePushIndex).find((p) => p.status === 200);
    assert.ok(restorePush, "restore publishes a push");
    assert.notEqual(restorePush.body.generation, beforeRestore.meta.generation);
    assert.equal(restorePush.body.rows.length, modified.notes.length, "restore sends every row");
    assert.equal(Object.hasOwn(restorePush.body, "confirm"), false);
    assert.equal(pushes.slice(restorePushIndex).some((p) => p.status === 409), false);
    await verifyCopy(modified); assertHealthy();
    pass("restore preview counts match; imported restore sends all rows without confirmation");

    activeCheck = "Disconnect during a held request";
    const heldState = holdNext((method, pathname) => method === "GET" && pathname === "/v1/state");
    await button(page, "Sync now").click(); await waitHeld(heldState);
    assert.equal(heldState.responseStatus, 200);
    await button(page, "Disconnect").click();
    await page.getByRole("dialog", { name: "Disconnect from the XPS?" }).getByRole("button", { name: "Disconnect", exact: true }).click();
    await button(page, "Connect").waitFor();
    // Read only key presence in this fresh fixture database; never return the token.
    const hasToken = () => page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("notes_app");
      request.onerror = () => reject(new Error("fixture-database-open"));
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("prefs", "readonly");
        const key = tx.objectStore("prefs").getKey("syncToken");
        key.onsuccess = () => resolve(key.result !== undefined);
        key.onerror = () => reject(new Error("fixture-token-key-read"));
        tx.oncomplete = () => db.close();
      };
    }));
    await until("local token forgotten", hasToken, (value) => !value);
    await until("DELETE unpairs the temporary service", status, (value) => value.paired === null);
    heldState.release(); await heldState.finished;
    const pushCountAtDisconnect = pushes.length;
    await back(); await back(); await button(page, edited.title).click();
    await page.getByLabel("Note body", { exact: true }).press("End");
    await page.getByLabel("Note body", { exact: true }).pressSequentially(" Disconnected fixture edit.");
    await back();
    await delay(12_000); // Cross the real ten-second quiet timer with a local edit pending.
    await page.reload({ waitUntil: "networkidle" });
    await button(page, "Settings").click(); await openSync(); await button(page, "Connect").waitFor();
    assert.equal(await hasToken(), false);
    assert.equal((await status()).round, restored.round);
    assert.equal(pushes.length, pushCountAtDisconnect);
    assertHealthy(); pass("Disconnect cancels a held request, forgets the token, unpairs and stays off after edit/reload");

    activeCheck = "import during a held image upload";
    // Reset the disconnected phone to the same sample-derived copy, then reconnect.
    await back(); await importNotebook(page, modified); await openSync(); await pair();
    await nextRound(restored.round); await waitSynced(page, modified);
    const old = await storeSnapshot(), racePushIndex = pushes.length;
    const variant = (marker, seed) => {
      const backup = structuredClone(modified);
      for (const note of backup.notes) {
        note.html += `<p>${marker}</p>`; note.text += `\n${marker}`; note.rev++;
      }
      const bytes = makePng(480, 270, true, seed);
      backup.files[0] = { ...backup.files[0], data: bytes.toString("base64"), size: bytes.length };
      return backup;
    };
    const uploadA = variant("Upload generation A fixture.", 11), uploadB = variant("Upload generation B fixture.", 29);
    const heldUpload = holdNext((method, pathname) => method === "PUT" && pathname.startsWith("/v1/files/"));
    await back(); await importNotebook(page, uploadA); await waitHeld(heldUpload);
    assert.equal(heldUpload.responseStatus, 200, "the delayed upload must have reached the real service");
    assert.ok(heldUpload.request.generation);
    assert.deepEqual(await storeSnapshot(), old, "an uploaded object alone must not publish a notebook");
    // The response for A is still held while the real Import replaces the phone with B.
    await importNotebook(page, uploadB);
    heldUpload.release(); await heldUpload.finished;
    await openSync(); await confirmation(page).waitFor();
    assert.deepEqual(await storeSnapshot(), old, "before approval the published notebook remains entirely old");
    const racePushes = pushes.slice(racePushIndex);
    assert.ok(racePushes.length > 0);
    assert.ok(racePushes.every((p) => p.body.generation !== heldUpload.request.generation), "cancelled upload generation must never push");
    for (const { body } of racePushes) {
      assert.equal(body.rows.length, uploadB.notes.length);
      assert.ok(body.rows.every((n) => n.html.includes("Upload generation B fixture.") && !n.html.includes("Upload generation A fixture.")));
    }
    await button(page, "Replace the XPS copy").click();
    await nextRound(old.meta.round); await waitSynced(page, uploadB);
    const newCopy = await verifyCopy(uploadB);
    assert.notEqual(newCopy.meta.generation, old.meta.generation);
    assert.notEqual(newCopy.meta.generation, heldUpload.request.generation);
    assert.ok(pushes.slice(racePushIndex).every((p) => p.body.generation === newCopy.meta.generation));
    assertHealthy(); pass("import during PUT cancels the old round; published rows and image bytes are entirely old or entirely new");

    activeCheck = "crash after commit and browser retry";
    await stop(); crashing = true; await start("commit");
    await back(); await back(); await button(page, edited.title).click();
    const crashEditor = page.getByLabel("Note body", { exact: true });
    await crashEditor.click(); await crashEditor.press("Control+End"); await crashEditor.press("End");
    await crashEditor.pressSequentially(" Crash recovery fixture.");
    const crashExit = await Promise.race([exited, delay(75_000, undefined, { ref: false }).then(() => { throw new Error("browser-crash-round-timeout"); })]);
    assert.equal(crashExit.code, 86);
    child = null; exited = null;
    const journal = await readJson(path.join(config.storeDir, "journal.json"));
    assert.equal(journal.step, "commit");
    assert.ok(journal.payload.next.notes.find((n) => n.id === edited.id).html.includes("Crash recovery fixture."));
    await back(); await button(page, "Settings").click(); await openSync();
    await page.getByText(unreachable, { exact: true }).waitFor();
    await start(); crashing = false;
    // A new successful browser round, not merely the startup replay of the crashed one.
    await button(page, "Sync now").click();
    await nextRound(journal.targetRound); await waitSynced(page, uploadB);
    assert.equal((await status()).journalPending, false);
    await assert.rejects(fs.stat(path.join(config.storeDir, "journal.json")), { code: "ENOENT" });
    const recovered = await readJson(path.join(config.storeDir, `store/notes/${keyFor(edited.id)}.json`));
    assert.ok(recovered.html.includes("Crash recovery fixture."));
    await verifyCopy({ ...uploadB, notes: journal.payload.next.notes });
    assertHealthy(); pass("commit crash shows unreachable; restart resolves the journal and the next browser round succeeds");
    print(`PASS ${passed}/${passed} browser checks; temporary loopback services only.`);
  } catch (error) {
    // Never print arbitrary Playwright/child-process errors: they can contain headers/codes.
    print(`FAIL browser: ${activeCheck} (${error.code ?? error.name})`);
    throw error;
  } finally {
    closing = true;
    for (const hold of holds) hold.release();
    try { await browser?.close(); }
    finally {
      await Promise.allSettled([...routeJobs]);
      try { await stop(); }
      finally {
        if (appServer) await new Promise((resolve) => {
          appServer.close(resolve); appServer.closeAllConnections();
        });
        await fs.rm(root, { recursive: true, force: true });
      }
    }
    assertNoTailnet?.();
    assert.deepEqual(unexpected, []);
    assert.deepEqual(routeErrors, []);
  }
}
if (isEntryPoint(import.meta.url)) {
  syncCheck().catch(() => {
    process.stderr.write("FAIL sync-check; the last check label identifies the failing stage.\n");
    process.exitCode = 1;
  });
}
