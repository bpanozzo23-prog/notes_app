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
const shot = async (name, fullPage = false, target = page) => { await target.waitForTimeout(400); await target.screenshot({ path: `${out}/${String(++step).padStart(2, "0")}-${name}.png`, fullPage }); };
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
// Links are placed locally; opening a source before Undo also checks editor serialization parity.
await button("Back").click(); // review → Ask
await button("Tidy the notebook").click(); await button("Links between notes").click();
if (await discardOther.isVisible()) await button("Discard and continue").click();
await disclosure.waitFor();
const linksDisclosure = await disclosure.textContent(); await shot("links-disclosure");
await disclosure.getByRole("button", { name: "Send", exact: true }).click();
const linksOutcome = await Promise.race([
  page.getByRole("button", { name: /^Apply \d+ changes?$/ }).waitFor().then(() => "proposal"),
  page.getByRole("alert").first().waitFor().then(async () => `failed: ${await page.getByRole("alert").first().textContent()}`),
  page.getByText("Claude suggests no changes.").waitFor().then(() => "no changes"),
]);
await shot("links-review", true);
const linksRows = await page.getByRole("checkbox").count();
const linksInline = await page.getByText(/^Links the words/).count(), linksSeeAlso = await page.getByText(/^Adds it to "See also:"/).count();
let linksApplied = null, linksUndone = null, linksSource = null, linksAfterText = null;
if (linksOutcome === "proposal") {
  linksSource = await page.getByRole("article").first().getByRole("heading", { level: 2 }).textContent();
  linksApplied = await page.getByRole("button", { name: /^Apply \d+ changes?$/ }).textContent();
  await page.getByRole("button", { name: /^Apply \d+ changes?$/ }).click();
  await page.getByText(/^Applied \d+ changes?\.$/).waitFor(); await shot("links-applied", true);
  // Use another tab in the same throwaway profile: visiting from the list in this tab would
  // replace forward history, losing the route back to the applied review (held only in memory).
  const sourcePage = await context.newPage(); await sourcePage.goto(url, { waitUntil: "networkidle" });
  await sourcePage.getByRole("button", { name: linksSource, exact: true }).click();
  await sourcePage.getByLabel("Note body").waitFor();
  linksAfterText = await sourcePage.getByLabel("Note body").innerText(); await shot("links-source-after", true, sourcePage);
  await sourcePage.getByRole("button", { name: "Back", exact: true }).click(); // Flush any editor save before Undo.
  await sourcePage.close();
  await button("Undo").click();
  linksUndone = await Promise.race([
    page.getByText("Earlier version restored.", { exact: true }).waitFor().then(() => "clean"),
    page.getByText(/^A note changed after Claude's edit/).waitFor().then(() => "conflict"),
  ]);
  await shot("links-undo", true);
}
// Merge and split each retain their own disclosure, review outcome and Undo result.
await button("Back").click(); // links review → Ask
await button("Tidy the notebook").click(); await button("Find duplicates to merge").click();
if (await discardOther.isVisible()) await button("Discard and continue").click();
await disclosure.waitFor();
const duplicates = { disclosure: (await disclosure.textContent())?.replace(/\s+/g, " ").trim() };
await shot("duplicates-disclosure"); await disclosure.getByRole("button", { name: "Send", exact: true }).click();
duplicates.outcome = await Promise.race([
  page.getByRole("article", { name: /^Suggested merge / }).first().waitFor().then(() => "suggestions"),
  page.getByText(/^(No suggested merges left|Claude found no duplicates to merge)\.$/).waitFor().then(() => "no merges"),
  page.getByRole("alert").first().waitFor().then(async () => `failed: ${await page.getByRole("alert").first().textContent()}`),
]);
duplicates.groups = await page.getByRole("article", { name: /^Suggested merge / }).count(); await shot("duplicates-review", true);
const merge = { outcome: "no group" };
if (duplicates.groups) {
  await page.getByRole("article", { name: /^Suggested merge / }).first().getByRole("button", { name: /^Merge \d+ notes…$/ }).click();
  await disclosure.waitFor(); merge.disclosure = (await disclosure.textContent())?.replace(/\s+/g, " ").trim(); await shot("merge-disclosure");
  await disclosure.getByRole("button", { name: "Send", exact: true }).click();
  merge.outcome = await Promise.race([
    button("Apply merge").waitFor().then(() => "proposal"),
    page.getByRole("alert").first().waitFor().then(async () => `failed: ${await page.getByRole("alert").first().textContent()}`),
  ]);
  merge.trashLines = await page.getByText(/^Moves to Trash:/).count(); merge.backlinkLines = await page.getByText(/^Also updates links in:/).count();
  merge.wordForWordLists = await page.getByRole("heading", { name: /^(Not in the merged note word for word:|New wording:)$/ }).count();
  merge.wordForWordItems = await page.locator('ul.list-disc li').count(); await shot("merge-review", true);
  if (merge.outcome === "proposal") {
    await button("Apply merge").click(); await page.getByText(/^Merged \d+ notes into/).waitFor();
    merge.applied = await page.getByText(/^Merged \d+ notes into/).textContent(); await shot("merge-applied", true);
    const title = /into “(.*)”\.$/.exec(merge.applied)?.[1];
    const mergedPage = await context.newPage(); await mergedPage.goto(url, { waitUntil: "networkidle" });
    await mergedPage.getByRole("button", { name: title, exact: true }).click(); await mergedPage.getByLabel("Note body").waitFor();
    merge.afterText = await mergedPage.getByLabel("Note body").innerText(); await shot("merge-note-after", true, mergedPage);
    await mergedPage.getByRole("button", { name: "Back", exact: true }).click(); await mergedPage.close();
    await button("Undo").click();
    merge.undone = await Promise.race([
      page.getByText("Merge undone.", { exact: true }).waitFor().then(() => "Merge undone."),
      page.getByText(/^Some notes changed after Claude's merge/).waitFor().then(() => "conflict"),
    ]); await shot("merge-undo", true);
  }
}
await button("Back").click(); await button("Back").click(); // review → Ask → list
await button("Vocabulario — comida").click(); await button("Claude").click(); await button("Split…").click();
if (await discardOther.isVisible()) await button("Discard and continue").click();
await disclosure.waitFor(); const split = { disclosure: (await disclosure.textContent())?.replace(/\s+/g, " ").trim() };
await shot("split-disclosure"); await disclosure.getByRole("button", { name: "Send", exact: true }).click();
split.outcome = await Promise.race([
  button("Apply split").waitFor().then(() => "proposal"),
  page.getByText("Claude suggests no split.", { exact: true }).first().waitFor().then(() => "no split"),
  page.getByRole("alert").first().waitFor().then(async () => `failed: ${await page.getByRole("alert").first().textContent()}`),
]);
split.newNotes = await page.getByRole("article").count(); await shot("split-review", true);
if (split.outcome === "proposal") {
  await button("Apply split").click(); await page.getByText(/^Split into \d+ new notes?\.$/).waitFor(); split.applied = await page.getByText(/^Split into \d+ new notes?\.$/).textContent();
  await button("Open the note").click(); await page.getByLabel("Note body").waitFor(); split.afterText = await page.getByLabel("Note body").innerText(); await shot("split-original-after", true);
  await button("Back").click(); await button("Undo").click();
  split.undone = await Promise.race([
    page.getByText("Split undone.", { exact: true }).waitFor().then(() => "Split undone."),
    page.getByText(/^Some notes changed after Claude's split/).waitFor().then(() => "conflict"),
  ]); await shot("split-undo", true);
}
await browser.close();

const messages = calls.filter((call) => call.path === "/v1/messages");
const summary = {
  disclosed: disclosed?.replace(/\s+/g, " ").trim(), sources, followEstimate, shownCosts,
  tidyDisclosure: tidyDisclosure?.replace(/\s+/g, " ").trim(), tidyOutcome: outcome, applied, undone,
  reorganise: { disclosure: reorganiseDisclosure?.replace(/\s+/g, " ").trim(), outcome: reorganiseOutcome, rows: reorganiseRows, applied: reorganiseApplied, undone: reorganiseUndone },
  links: { disclosure: linksDisclosure?.replace(/\s+/g, " ").trim(), outcome: linksOutcome, rows: linksRows, inline: linksInline, seeAlso: linksSeeAlso, applied: linksApplied, source: linksSource, afterText: linksAfterText, undone: linksUndone },
  duplicates, merge, split,
  calls, totalDollars: messages.reduce((sum, call) => sum + (call.dollars ?? 0), 0),
  followUpReadCache: (messages[1]?.usage?.cache_read_input_tokens ?? 0) > 0,
};
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
