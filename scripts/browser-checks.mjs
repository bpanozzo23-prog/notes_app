// Free browser checks on a production build: the service-worker update prompt (also with a Claude
// conversation open, and when another tab activates the update), reopening offline, freezing the
// page mid-answer (what Android does when you switch apps), and a connection dropped mid-answer.
//   node scripts/browser-checks.mjs [out-dir]
// Builds the app twice into out-dir (an "a" and a "b" release that differ by one marker), serves
// them itself, and drives headless Chromium at phone size. No request reaches Anthropic: the
// page's requests for api.anthropic.com are sent to this script's own server, which streams
// made-up answers (src/claude/fixtures) and can pause or cut them. The made-up sample notebook is
// imported; nothing from the owner's notes is involved. Writes summary.json and a few PNGs.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium, devices } from "playwright";
import { guardTailnet } from "./tailnet-guard.mjs";
import { notebookAnswer, followupAnswer } from "../src/claude/fixtures/ask.js";
import { sseFrames } from "../src/claude/fixtures/responses.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(process.argv[2] ?? "private-data/browser-checks");
const sample = resolve(root, "public/sample-notebook.json");
mkdirSync(out, { recursive: true });

// Two releases. The marker changes index.html, so the service worker's precache list changes and
// the browser sees a new worker, exactly as with a real deployment.
const marker = (name) => ({ name: "browser-check-marker", transformIndexHtml: (html) => html.replace("</head>", `<meta name="browser-check-build" content="${name}"></head>`) });
for (const name of ["a", "b"]) {
  await build({ root, configFile: resolve(root, "vite.config.js"), logLevel: "error", plugins: [marker(name)], build: { outDir: resolve(out, `build-${name}`), emptyOutDir: true } });
}

// A static server for /notes_app/ whose release can be switched, plus a stand-in for Anthropic.
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
let release = resolve(out, "build-a");
const served = [], claudeRequests = [], answers = [];
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://local").pathname;
  if (req.method === "POST" && path === "/notes_app/__fake-anthropic/v1/messages") return claude(req, res);
  const file = resolve(release, path.replace(/^\/notes_app\/?/, "") || "index.html");
  if (!path.startsWith("/notes_app/") || !file.startsWith(release + sep)) { res.writeHead(404).end(); return; }
  try {
    const data = await readFile(file);
    served.push(path);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" }).end(data);
  } catch { res.writeHead(404).end(); }
});
// Each queued answer: frames, and optionally `cutAt` (drop the connection before that frame) and
// `holdAt` (wait for answer.release() before that frame).
function queueAnswer(events, options = {}) {
  const answer = { frames: sseFrames(events), ...options, started: null };
  answer.held = new Promise((done) => { answer.release = done; });
  answer.started = new Promise((done) => { answer.begin = done; });
  answers.push(answer);
  return answer;
}
async function claude(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;
  claudeRequests.push(JSON.parse(body));
  const answer = answers.shift();
  if (!answer) { res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "api_error", message: "No made-up answer queued" } })); return; }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": "req_browser_check" });
  answer.begin();
  for (const [index, frame] of answer.frames.entries()) {
    if (answer.holdAt === index) await answer.held;
    if (answer.cutAt === index) { res.destroy(); return; }
    res.write(frame); await wait(20);
  }
  res.end();
}
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/notes_app/`;

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"], locale: "en-GB" });
const assertNoTailnet = await guardTailnet(context);
// Fail closed: nothing may reach the real Anthropic API.
const unexpected = [];
await context.route("https://api.anthropic.com/**", async (route) => { unexpected.push(route.request().url()); await route.abort(); });
await context.addInitScript(() => {
  const original = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    if (target.origin !== "https://api.anthropic.com" || target.pathname !== "/v1/messages") return original(input, options);
    const body = options.body ?? await input.clone().text();
    return original(`${location.origin}/notes_app/__fake-anthropic/v1/messages`, { method: "POST", body, headers: { "content-type": "application/json" }, signal: options.signal ?? input.signal });
  };
});

const results = [];
function check(name, ok, detail = "") { results.push({ name, ok: !!ok, ...(detail ? { detail } : {}) }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); }
async function attempt(name, task) {
  try { const result = await task(); typeof result === "object" ? check(name, result.ok, result.detail) : check(name, result); }
  catch (error) { check(name, false, error.message.split("\n")[0]); }
}
const shot = async (page, name, top = false) => { if (top) await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${out}/${name}.png` }); };
const buttonIn = (page) => (name) => page.getByRole("button", { name, exact: true });
const buildOf = (page) => page.evaluate(() => document.querySelector('meta[name="browser-check-build"]')?.content ?? null);
const costLabel = /^(under 1¢|\d+¢|\$\d+\.\d\d|at least .+|cost unknown) · /;

const page = await context.newPage();
page.setDefaultTimeout(15_000);
page.on("pageerror", (error) => console.log("pageerror:", error.message));
const button = buttonIn(page);

// 1. Install: the first visit installs the worker; the next load is served through it.
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: "networkidle" });
check("service worker controls the page after install", await page.evaluate(() => !!navigator.serviceWorker.controller));
check("release a is running", (await buildOf(page)) === "a");

await attempt("manifest has a Quick add shortcut under the app base", async () => {
  const manifest = JSON.parse(await readFile(resolve(out, "build-a/manifest.webmanifest"), "utf8"));
  const shortcut = manifest.shortcuts?.find((entry) => entry.name === "Quick add");
  if (!shortcut) return false;
  const target = new URL(shortcut.url, url), base = new URL(url);
  return target.origin === base.origin && target.pathname.startsWith(base.pathname) && target.searchParams.has("quick-add");
});
async function checkQuickAddLaunch() {
  await page.goto(url + "?quick-add", { waitUntil: "load" });
  await page.getByRole("dialog", { name: "Quick add", exact: true }).waitFor();
  const clean = new URL(page.url()).search === "";
  await button("Cancel").click();
  await page.getByRole("dialog", { name: "Quick add", exact: true }).waitFor({ state: "hidden" });
  return clean;
}
await attempt("Quick add shortcut opens the sheet and consumes its query", checkQuickAddLaunch);

// The made-up sample notebook, through the app's own import.
await button("Settings").click();
await page.getByLabel("Import backup").setInputFiles(sample);
await button("Replace notebook").click();
const safety = page.waitForEvent("download");
await button("Import and replace").click(); await safety;
await page.getByText(/^Backup imported\./).waitFor();
// Claude on with an obviously fake key (it only ever reaches this script's server).
await button("Claude Off").click();
await page.getByRole("checkbox", { name: "I have set a monthly spend limit in the Anthropic console" }).check();
await page.getByLabel("Anthropic API key", { exact: true }).fill("sk-ant-FAKE-KEY-FOR-BROWSER-CHECKS");
await button("Save key and turn on").click();
await button("Back").click(); await button("Back").click();

// 2. Offline: the app reopens from the worker's cache with the notes, and Ask says it's offline.
await context.setOffline(true);
const before = served.length;
await attempt("reopens offline with the notes", async () => {
  await page.reload({ waitUntil: "load" });
  await button("Vocabulario — comida").waitFor();
  // The browser's own background worker-update check (sw.js and the workbox file it imports) isn't
  // covered by offline emulation and isn't page traffic; every app file must come from the cache.
  const fetched = served.slice(before).filter((path) => !/\/(sw|workbox-[\w-]+)\.js$/.test(path));
  return { ok: fetched.length === 0, detail: fetched.join(", ") };
});
await shot(page, "01-offline-reopen");
await attempt("Quick add shortcut opens offline and consumes its query", checkQuickAddLaunch);
await attempt("Ask is disabled offline", async () => {
  await page.getByRole("button", { name: "Ask Claude" }).click();
  await page.getByText("You're offline. Claude needs a connection.").first().waitFor();
  await page.getByLabel("Your question").fill("¿Qué tengo que repasar?");
  return await button("Send").isDisabled();
});
await shot(page, "02-offline-ask");
await context.setOffline(false);
await page.getByText("You're offline. Claude needs a connection.").first().waitFor({ state: "detached" }).catch(() => {});

async function askFirst(question) {
  await page.getByLabel("Your question").fill(question);
  await button("Send").click();
  await page.getByRole("dialog", { name: "Send to Anthropic?" }).getByRole("button", { name: "Send", exact: true }).click();
}
async function newQuestion() {
  await button("New question").click();
  await button("Clear conversation").click();
}
// A complete answer's cost label (a stopped or lost one says "at least …").
const finished = async () => {
  await page.getByText("Connection lost", { exact: true }).waitFor({ state: "detached" });
  await page.getByText(/^(under 1¢|\d+¢|\$\d+\.\d\d) · /).last().waitFor();
};

// 3. A connection dropped mid-answer: what arrived stays, marked, with Try again.
const cut = queueAnswer(notebookAnswer, { cutAt: 5 }); // after the first words
await askFirst("¿Qué tengo que repasar de español?");
await attempt("dropped connection shows what arrived and \"Connection lost\"", async () => {
  await cut.started; await page.getByText("Connection lost", { exact: true }).waitFor();
  return (await page.getByText(/^Repasa pret/).count()) > 0 && await button("Try again").isVisible();
});
await shot(page, "03-connection-lost");
queueAnswer(notebookAnswer);
await attempt("Try again completes the answer without repeating the question", async () => {
  await button("Try again").click(); await finished();
  const last = claudeRequests.at(-1), lost = await page.getByText("Connection lost", { exact: true }).count();
  return { ok: last.messages.length === 1 && lost === 0, detail: `messages ${last.messages.length}, lost labels ${lost}` };
});

// 4. The page frozen mid-answer (Android app switch) and resumed: the answer completes.
const cdp = await context.newCDPSession(page);
await newQuestion();
const frozen = queueAnswer(notebookAnswer, { holdAt: 5 });
await askFirst("¿Qué repaso hoy?");
await attempt("an answer streamed while the page was frozen completes after resume", async () => {
  await frozen.started; await page.getByText(/^Repasa pret/).waitFor();
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  frozen.release(); await wait(2000);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await finished();
  return await page.getByText("Connection lost", { exact: true }).count() === 0;
});
await shot(page, "04-frozen-resumed");

// 5. Frozen, and the connection dies meanwhile (the phone may close it): Connection lost on resume.
await newQuestion();
const frozenCut = queueAnswer(notebookAnswer, { holdAt: 5, cutAt: 5 });
await askFirst("¿Y mañana?");
await attempt("a connection dropped while frozen shows \"Connection lost\" on resume", async () => {
  await frozenCut.started; await page.getByText(/^Repasa pret/).waitFor();
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  frozenCut.release(); await wait(1500);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.getByText("Connection lost", { exact: true }).waitFor();
  return await button("Try again").isVisible();
});
queueAnswer(notebookAnswer);
await button("Try again").click(); await finished();

// 6. An update arrives while Claude is answering: Reload waits for the answer, then says it clears
// the conversation, and the page never reloads by itself.
const followUp = queueAnswer(followupAnswer, { holdAt: 5 });
await page.getByLabel("Follow-up question").fill("¿Me das un ejercicio?");
await page.getByRole("button", { name: /^Send · / }).click();
await followUp.started;
release = resolve(out, "build-b");
await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
const update = page.getByRole("complementary", { name: "App update" });
await attempt("update banner waits while Claude answers", async () => {
  await update.waitFor();
  return await update.getByRole("button").isDisabled() && await update.getByText("Waiting for Claude's answer.").isVisible();
});
await shot(page, "05-update-while-answering", true);
followUp.release(); await page.waitForFunction(() => document.body.innerText.match(/(under 1¢|\d+¢|\$\d+\.\d\d|at least [^·]+|cost unknown) · /g)?.length >= 2);
await attempt("after the answer, Reload says it clears the conversation; no automatic reload", async () => {
  const reload = update.getByRole("button", { name: "Reload (clears Claude's conversation)" });
  await reload.waitFor(); await wait(2000);
  return await reload.isEnabled() && (await buildOf(page)) === "a";
});
await shot(page, "06-update-with-conversation", true);

// 7. Another tab activates the update: this tab keeps its conversation and doesn't reload.
const other = await context.newPage();
await other.goto(url, { waitUntil: "networkidle" });
await attempt("another tab can apply the update", async () => {
  const reload = other.getByRole("complementary", { name: "App update" }).getByRole("button", { name: "Reload", exact: true });
  await reload.waitFor();
  await Promise.all([other.waitForEvent("load"), reload.click()]);
  await other.waitForLoadState("networkidle");
  return (await buildOf(other)) === "b";
});
await attempt("this tab keeps its conversation when another tab activated the update", async () => {
  await wait(2500);
  return (await buildOf(page)) === "a" && await page.getByText(costLabel).count() >= 2 &&
    await update.getByRole("button", { name: "Reload (clears Claude's conversation)" }).isVisible();
});
await shot(page, "07-other-tab-updated", true);
await other.close();

// 8. The owner's Reload: the new release, notes intact, conversation cleared.
await attempt("Reload brings the new release; the conversation is cleared", async () => {
  await Promise.all([page.waitForEvent("load"), update.getByRole("button").click()]);
  await page.waitForLoadState("networkidle");
  return (await buildOf(page)) === "b" && await page.getByText(costLabel).count() === 0;
});
await attempt("the notes survived the update", async () => {
  await button("Back").click(); // the app reopens on the screen it was showing (Ask)
  await button("Vocabulario — comida").waitFor();
  return (await buildOf(page)) === "b";
});
await shot(page, "08-after-update");

await browser.close();
server.close();
assertNoTailnet();
check("no request reached the real Anthropic API", unexpected.length === 0, unexpected.join(", "));
const summary = { at: new Date().toISOString(), passed: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results,
  claudeRequests: claudeRequests.length };
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(`${summary.passed} passed, ${summary.failed} failed`);
process.exit(summary.failed ? 1 : 0);
