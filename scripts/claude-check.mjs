// Real-request check of the Claude features, against the made-up sample notebook only.
// Spends real money on the agent's test key (AGENTS.md: up to $1 per step without asking).
//   node scripts/claude-check.mjs --real [out-dir] [url]
// Defaults: out-dir private-data/claude-check (gitignored), url the dev server.
// The key is read from ~/.config/notes_app/test-key and typed into a throwaway browser profile;
// it is never printed. Request headers are never logged.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import { priceUsage } from "../src/claude/config.js";

const args = process.argv.slice(2).filter((arg) => arg !== "--real");
if (!process.argv.includes("--real")) {
  console.error("This makes real, paid requests with the test key. Run with --real.");
  process.exit(2);
}
const out = args[0] ?? "private-data/claude-check";
const url = args[1] ?? "http://localhost:5174/notes_app/";
const key = readFileSync(`${homedir()}/.config/notes_app/test-key`, "utf8").trim();
const sample = fileURLToPath(new URL("../public/sample-notebook.json", import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"], locale: "en-GB", serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(180_000); // real answers take a while
page.on("pageerror", (error) => console.log("pageerror:", error.message));

// Record every Anthropic response's usage from the streamed events (bodies only, never headers).
const calls = [];
page.on("response", async (response) => {
  const target = new URL(response.url());
  if (target.hostname !== "api.anthropic.com") return;
  const call = { path: target.pathname, status: response.status() };
  calls.push(call);
  try {
    const text = await response.text();
    if (target.pathname === "/v1/messages/count_tokens") { call.inputTokens = JSON.parse(text).input_tokens; return; }
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "message_start") { call.model = event.message.model; call.id = event.message.id; call.usage = { ...event.message.usage }; }
      if (event.type === "message_delta") { call.stop = event.delta?.stop_reason; Object.assign(call.usage ??= {}, event.usage ?? {}); }
      if (event.type === "error") call.error = event.error?.type;
    }
    if (call.usage) call.dollars = priceUsage(call.model, { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...call.usage });
  } catch (error) { call.readError = error.message; }
});

let step = 0;
const shot = async (name, fullPage = false) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${String(++step).padStart(2, "0")}-${name}.png`, fullPage }); };
const button = (name) => page.getByRole("button", { name, exact: true });
const costLabels = () => page.getByText(/^(under 1¢|\d+¢|\$\d+\.\d\d|at least .+|cost unknown) · /);

await page.goto(url, { waitUntil: "networkidle" });
await button("Settings").click();
await page.getByLabel("Import backup").setInputFiles(sample);
await button("Replace notebook").click();
const download = page.waitForEvent("download");
await button("Import and replace").click();
await download;
await page.getByText(/^Backup imported\./).waitFor();

// Turn Claude on with the test key and check it (free).
await button("Claude Off").click();
await page.getByRole("checkbox", { name: "I have set a monthly spend limit in the Anthropic console" }).check();
await page.getByLabel("Anthropic API key", { exact: true }).fill(key);
await button("Save key and turn on").click();
await button("Test key").click();
await page.getByText("The key works.", { exact: true }).waitFor();
await button("Back").click();
await button("Back").click();

// A whole-notebook question, then a follow-up that should read the cache.
await button("Ask Claude").click();
await page.getByLabel("Your question").fill("¿Qué tengo que repasar de español esta semana?");
await button("Send").click();
const disclosure = page.getByRole("dialog", { name: "Send to Anthropic?" });
const disclosed = await disclosure.textContent();
await shot("ask-disclosure");
await disclosure.getByRole("button", { name: "Send", exact: true }).click();
await costLabels().first().waitFor();
await shot("ask-answer", true);
const sources = await page.getByRole("region", { name: "Sources" }).count();
await page.getByLabel("Follow-up question").fill("¿Y cuáles de mis frases útiles debería practicar primero?");
const followEstimate = await page.getByRole("button", { name: /^Send · / }).textContent();
await page.getByRole("button", { name: /^Send · / }).click();
await page.waitForFunction(() => document.body.innerText.match(/(under 1¢|\d+¢|\$\d+\.\d\d|at least [^·]+|cost unknown) · /g)?.length >= 2);
await shot("ask-followup", true);
const shownCosts = await costLabels().allTextContents();

// Tidy one note, apply, and undo.
await button("Back").click();
await button("Notas de clase").click();
await button("Claude").click();
await button("Continue").click();
const tidyDisclosure = await disclosure.textContent();
await disclosure.getByRole("button", { name: "Send", exact: true }).click();
const outcome = await Promise.race([
  page.getByRole("button", { name: /^Apply \d+ changes?$/ }).waitFor().then(() => "proposal"),
  page.getByRole("alert").first().waitFor().then(async () => `failed: ${await page.getByRole("alert").first().textContent()}`),
  page.getByText("Claude suggests no changes.").waitFor().then(() => "no changes"),
]);
await shot("tidy-review", true);
let applied = null, undone = null;
if (outcome === "proposal") {
  applied = await page.getByRole("button", { name: /^Apply \d+ changes?$/ }).textContent();
  await page.getByRole("button", { name: /^Apply \d+ changes?$/ }).click();
  await page.getByText(/^Applied \d+ changes?\.$/).waitFor();
  await button("Back").click();
  await page.getByLabel("Note body").waitFor();
  await shot("tidy-note-after", true);
  const afterText = await page.getByLabel("Note body").innerText();
  await page.goForward();
  await button("Undo").click();
  undone = await Promise.race([
    page.getByText("Earlier version restored.", { exact: true }).waitFor().then(() => "clean"),
    page.getByText(/^A note changed after Claude's edit/).waitFor().then(() => "conflict"),
  ]);
  applied = { button: applied, afterText };
}
// Notebook metadata proposal; record failures/no-ops as well as an approved review.
await button("Back").click(); // review → note
await button("Back").click(); // note → list
await button("Ask Claude").click(); await button("Tidy the notebook").click();
await button("Titles, tags and folders").click();
const discardOther = page.getByRole("dialog", { name: "Discard Claude's other proposal?" });
if (await discardOther.isVisible()) await button("Discard and continue").click();
await disclosure.waitFor();
const reorganiseDisclosure = await disclosure.textContent(); await shot("reorganise-disclosure");
await disclosure.getByRole("button", { name: "Send", exact: true }).click();
const reorganiseOutcome = await Promise.race([
  page.getByRole("button", { name: /^Apply \d+ changes?$/ }).waitFor().then(() => "proposal"),
  page.getByRole("alert").first().waitFor().then(async () => `failed: ${await page.getByRole("alert").first().textContent()}`),
  page.getByText("Claude suggests no changes.").waitFor().then(() => "no changes"),
]);
await shot("reorganise-review", true);
const reorganiseRows = await page.getByRole("checkbox").count();
let reorganiseApplied = null, reorganiseUndone = null;
if (reorganiseOutcome === "proposal") {
  reorganiseApplied = await page.getByRole("button", { name: /^Apply \d+ changes?$/ }).textContent();
  await page.getByRole("button", { name: /^Apply \d+ changes?$/ }).click();
  await page.getByText(/^Applied \d+ changes?\.$/).waitFor(); await shot("reorganise-applied", true);
  await button("Undo").click();
  reorganiseUndone = await Promise.race([
    page.getByText("Earlier version restored.", { exact: true }).waitFor().then(() => "clean"),
    page.getByText(/^A note changed after Claude's edit/).waitFor().then(() => "conflict"),
  ]);
  await shot("reorganise-undo", true);
}
await browser.close();

const messages = calls.filter((call) => call.path === "/v1/messages");
const summary = {
  disclosed: disclosed?.replace(/\s+/g, " ").trim(), sources, followEstimate, shownCosts,
  tidyDisclosure: tidyDisclosure?.replace(/\s+/g, " ").trim(), tidyOutcome: outcome, applied, undone,
  reorganise: { disclosure: reorganiseDisclosure?.replace(/\s+/g, " ").trim(), outcome: reorganiseOutcome, rows: reorganiseRows, applied: reorganiseApplied, undone: reorganiseUndone },
  calls, totalDollars: messages.reduce((sum, call) => sum + (call.dollars ?? 0), 0),
  followUpReadCache: (messages[1]?.usage?.cache_read_input_tokens ?? 0) > 0,
};
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
