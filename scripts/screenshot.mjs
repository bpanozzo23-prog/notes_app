// Render the app in headless Chromium at phone size and save screenshots, so an agent can see
// the layout without the owner's phone. Usage:
//   node scripts/screenshot.mjs [out-dir] [url] [width] [height]
// Defaults: out-dir private-data/shots (gitignored), url http://localhost:5174/notes_app/
// (the dev server; pass https://bpanozzo23-prog.github.io/notes_app/ for the published app).
// Storage is fresh on every run; the made-up public/sample-notebook.json is imported through
// the app's own Settings → Import flow. Nothing from the owner's notes is involved.
import { makePng } from "./image-fixture.mjs";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import { notebookAnswer, followupAnswer, noteAnswer, refusalAnswer, cutAnswer, overloadedAnswer, fallbackAnswer } from "../src/claude/fixtures/ask.js";
import { tidyClass, tidyImage, tidyMalformed, tidyCut, tidyRefusal, tidyUnknown } from "../src/claude/fixtures/tidy.js";
import { reorganiseNotebook } from "../src/claude/fixtures/reorganise.js";
import { duplicatesShotsEvents } from "../src/claude/fixtures/duplicates.js";
import { mergeShotsEvents } from "../src/claude/fixtures/merge.js";
import { splitShotsEvents } from "../src/claude/fixtures/split.js";
import { linksShotsEvents } from "../src/claude/fixtures/links.js";
import { sseFrames } from "../src/claude/fixtures/responses.js";
import { installSteppedClaudeFetch } from "../src/claude/fixtures/browser.js";

const out = process.argv[2] ?? "private-data/shots";
const url = process.argv[3] ?? "http://localhost:5174/notes_app/";
const viewport = {
  width: Number(process.argv[4] ?? devices["Pixel 7"].viewport.width),
  height: Number(process.argv[5] ?? devices["Pixel 7"].viewport.height),
};
const sample = fileURLToPath(new URL("../public/sample-notebook.json", import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
// Pixel 7 is the closest built-in profile to the owner's S25 Ultra: 412 px wide, 2.6x, touch.
const context = await browser.newContext({ ...devices["Pixel 7"], viewport, locale: "en-GB", serviceWorkers: "block" });
const unexpectedAnthropic = [];
await context.route("https://api.anthropic.com/**", async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (request.method() === "POST" && path === "/v1/messages/count_tokens") {
    const rejected = request.headers()["x-api-key"] === "sk-ant-FAKE-REJECTED";
    await route.fulfill({ status: rejected ? 401 : 200, contentType: "application/json", body: JSON.stringify(rejected
      ? { type: "error", error: { type: "authentication_error", message: "Made-up rejected key" } }
      : { input_tokens: 8 }) });
  } else {
    unexpectedAnthropic.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ type: "error", error: { type: "api_error", message: "Unexpected fixture request" } }) });
  }
});
// Question markers are a screenshot convention only, never part of the app.
await context.addInitScript(installSteppedClaudeFetch, { smoke: sseFrames(), cases: [
  ["Find notes in this notebook that duplicate each other.", duplicatesShotsEvents],
  ["Merge these notes into one note.", mergeShotsEvents],
  ["Split this note into separate notes.", splitShotsEvents],
  ["Suggest better titles, tags and folders across this notebook.", reorganiseNotebook],
  ["Suggest links between related notes in this notebook.", linksShotsEvents],
  ["[shot:tidy-class]", tidyClass], ["[shot:tidy-image]", tidyImage], ["[shot:tidy-invalid]", tidyMalformed],
  ["[shot:tidy-cut]", tidyCut], ["[shot:tidy-refusal]", tidyRefusal], ["[shot:tidy-unknown]", tidyUnknown],
  ["[shot:refusal]", refusalAnswer], ["[shot:cut]", cutAnswer], ["[shot:overloaded]", overloadedAnswer],
  ["[shot:fallback]", fallbackAnswer], ["¿Me das un ejercicio?", followupAnswer],
  ["Describe la captura", noteAnswer], ["repasar", notebookAnswer],
].map(([match, events]) => ({ match, frames: sseFrames(events) })) });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("pageerror:", error.message));
page.on("console", (message) => { if (["error", "warning"].includes(message.type())) console.log(`console.${message.type()}:`, message.text()); });

const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png` }); console.log(`${out}/${name}.png`); };
const button = (name) => page.getByRole("button", { name, exact: true });
const back = () => button("Back").click();
const checkPopup = async () => {
  const box = await page.getByRole("toolbar", { name: "Selection formatting", exact: true }).boundingBox();
  if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) {
    throw new Error(`Selection pop-up is outside the visible viewport: ${JSON.stringify(box)}`);
  }
  const dock = await page.locator("[data-formatting-dock]").boundingBox();
  if (dock && box.y + box.height > dock.y) throw new Error("Selection pop-up overlaps the toolbar or hint");
};

await page.goto(url, { waitUntil: "networkidle" });
// Non-screenshot smoke check: prove the in-page wrapper remains a stepped stream.
await page.evaluate(() => {
  window.__claudeSmoke = { text: "", done: false, error: false };
  void (async () => {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ stream: true }) });
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        const event = JSON.parse(data.slice(6));
        if (event.delta?.type === "text_delta") window.__claudeSmoke.text += event.delta.text;
      }
    }
    window.__claudeSmoke.done = true;
  })().catch(() => { window.__claudeSmoke.error = true; });
});
await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__claudeStreams.at(-1).release(); });
await page.waitForFunction(() => window.__claudeSmoke.text === "Café " && !window.__claudeSmoke.done);
await page.evaluate(() => window.__claudeStreams.at(-1).release());
await page.waitForFunction(() => window.__claudeSmoke.text === "Café opens on Sunday." && !window.__claudeSmoke.done);
await page.evaluate(() => { while (window.__claudeStreams.at(-1).release()) { /* release remaining events */ } });
await page.waitForFunction(() => window.__claudeSmoke.done && !window.__claudeSmoke.error);
await shot("01-list-empty");

// Import the sample notebook the way the owner would (the safety download is accepted silently).
await button("Settings").click();
await page.getByLabel("Import backup").setInputFiles(sample);
await page.getByText(/^1 image \(/).waitFor();
await page.getByText(/^1 image \(/).evaluate((element) => element.parentElement.scrollIntoView({ block: "center" }));
await shot("54-import-image-preview");
await button("Replace notebook").click();
await shot("02-import-confirm");
const download = page.waitForEvent("download");
await button("Import and replace").click();
await download;
await page.getByText(/^Backup imported\./).waitFor();
await shot("03-settings-after-import");
// Export the pristine public sample before any screenshot step edits its notes.
await button("Export notes as text").scrollIntoViewIfNeeded();
await shot("106-settings-text-export");
const textDownload = page.waitForEvent("download");
await button("Export notes as text").click();
await (await textDownload).saveAs(`${out}/106-sample-export.md`);
await back();
await shot("04-list");

await page.getByRole("button", { name: "Español" }).click();
await shot("05-list-folder-filter");
await page.getByRole("button", { name: "#spanish" }).click();
await page.getByLabel("Search notes").fill("nino");
await shot("06-search-accent-insensitive");
await button("Clear search").click();
await button("All").click();

await button("Vocabulario — comida").click();
await shot("07-note-vocab");
await shot("107-note-copy-as-text");
// Force the real plain-HTTP fallback even when running against HTTPS or localhost.
await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
await button("Copy as text").click();
await page.getByText("Copied as text.", { exact: true }).waitFor();
await shot("108-note-copied-as-text");
await page.evaluate(() => { delete navigator.clipboard; });
await page.getByLabel("Note body").click();
await page.keyboard.press("Control+A");
await shot("08-selection-menu");
await checkPopup();
await page.keyboard.press("ArrowRight");
await button("Link to note").first().click();
await page.getByLabel("Find note to link").fill("gram");
await shot("09-link-picker");
await button("Cancel").click();
await page.getByRole("link", { name: "Gramática — ser y estar" }).click();
await shot("10-note-opened-from-link");
await page.mouse.wheel(0, 2000);
await shot("11-linked-from");
await back();
await back();

await button("Nota larga para probar el scroll").click();
await page.waitForFunction(() => document.querySelector('[aria-label="Title"]')?.value === "Nota larga para probar el scroll" &&
  document.querySelector('main > div[aria-busy]')?.getAttribute("aria-busy") === "false");
await page.evaluate(() => window.scrollTo(0, 1200));
await shot("12-long-note-scrolled");
await back();

await button("Trash (1)").click();
await shot("13-trash");
await back();
await button("Folders").click();
await shot("14-folders");
await back();
await button("Settings").click();
await shot("15-settings");

// Phase 2b: customise only this context's fixture preferences through the real controls.
await button("Toolbar").click();
await shot("20-toolbar-settings");
await button("+ Add buttons").click();
await shot("21-add-buttons");
await button("Add Heading 3").click();
await button("Done").click();
await page.getByLabel("Two rows", { exact: true }).click();
await page.waitForFunction(() => document.querySelector('input[value="rows"]').checked);
await page.evaluate(() => window.scrollTo(0, 0));
await shot("22-toolbar-settings-two-rows");
await back(); await back();
await button("Vocabulario — comida").click();
await page.getByLabel("Note body").click();
await shot("23-note-two-rows");
const toolbar = page.getByRole("toolbar", { name: "Formatting", exact: true });
await toolbar.getByRole("button", { name: "More", exact: true }).click();
await shot("24-more-tray-two-rows");
await button("Close tray").click();
const bold = toolbar.getByRole("button", { name: "Bold", exact: true });
const wasPressed = await bold.getAttribute("aria-pressed");
const box = await bold.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.getByRole("tooltip").waitFor();
await shot("25-long-press-label");
await page.mouse.up();
if (await bold.getAttribute("aria-pressed") !== wasPressed) throw new Error("Long press ran its action");
await back();
await button("Settings").click();
await button("Toolbar").click();
await page.getByLabel("One row + More", { exact: true }).click();
await page.waitForFunction(() => document.querySelector('input[value="more"]').checked);
await back(); await back();
await button("Vocabulario — comida").click();
await page.getByLabel("Note body").click();
await shot("26-note-one-row-more");
await toolbar.getByRole("button", { name: "More", exact: true }).click();
await shot("27-more-tray-one-row");
// Browser Back must restore this same history entry after dismissing the tray.
await page.evaluate(() => history.back());
await page.getByRole("region", { name: "More tray" }).waitFor({ state: "hidden" });
await page.waitForFunction(() => history.state.notesNavigation.stack.at(-1).screen === "note");
await back();
await button("Settings").click();
await button("Selection pop-up").click();
await shot("28-selection-popup-settings");
await button("+ Add buttons").click();
for (const label of ["Strikethrough", "Default colour", "Purple", "Black", "Grey", "Brown", "Orange", "Teal", "Cyan", "Indigo", "Pink", "Heading 1", "Heading 2", "Heading 3"]) {
  await button(`Add ${label}`).click();
}
await button("Done").click();
await page.evaluate(() => window.scrollTo(0, 0));
await shot("29-selection-popup-settings-long");
await back(); await back();
await button("Vocabulario — comida").click();
await page.getByLabel("Note body").click();
await page.keyboard.press("Control+A");
await shot("30-selection-popup-two-rows");
const popup = page.getByRole("toolbar", { name: "Selection formatting", exact: true });
await checkPopup();
await popup.getByRole("button", { name: "More", exact: true }).click();
await shot("31-selection-popup-more-tray");
await button("Close tray").click();
await back();
await button("Settings").click();

// Phase 2c: both palettes, custom-colour form, the formatting sample, and every picker.
await button("Colours").click();
await shot("32-colours-text");
await button("Highlight").click();
await shot("33-colours-highlight");
await button("+ Add a colour").click();
await page.getByLabel("Name", { exact: true }).fill("Lavanda de muestra");
await page.getByLabel("Colour", { exact: true }).fill("#e9d5ff");
await shot("34-add-colour");
await button("Cancel").click();
await back();
await button("Toolbar").click();
await button("+ Add buttons").click();
for (const group of ["Colours", "Size & font", "Lines & blocks"]) {
  await page.getByRole("heading", { name: group, exact: true }).evaluate((element) => element.scrollIntoView({ block: "start" }));
  await shot(`35-add-buttons-${group === "Colours" ? "colours" : group === "Size & font" ? "font" : "blocks"}`);
}
await button("Add Tip callout").evaluate((element) => element.scrollIntoView({ block: "start" }));
await shot("35-add-buttons-callouts-dividers");
for (const label of ["Typeface", "Line spacing", "Divider styles"]) await button(`Add ${label}`).click();
await button("Done").click();
await page.getByLabel("One row, swipe", { exact: true }).click();
await back(); await back();
await button("Muestra de formato").click();
await shot("36-formatting-note");
await page.locator('[data-callout="note"]').evaluate((element) => element.scrollIntoView({ block: "start" }));
await shot("37-formatting-callouts");
await page.locator('hr[data-style="dashed"]').scrollIntoViewIfNeeded();
await shot("38-formatting-dividers");
await page.getByLabel("Note body").locator("p").first().click();
await page.keyboard.press("Home");
for (const [label, slug] of [["Text colour", "text-colour"], ["Highlight colour", "highlight-colour"], ["Font size", "size"],
  ["Typeface", "typeface"], ["Heading", "heading"], ["Line spacing", "spacing"], ["Callout", "callout"], ["Divider styles", "divider"]]) {
  await toolbar.getByRole("button", { name: label, exact: true }).click();
  await shot(`39-tray-${slug}`);
  await button("Close tray").click();
}
// Phase 2d: styles and painter use fixture text and real toolbar/form controls.
const selectText = async (text, range = false) => {
  await page.evaluate(({ text, range }) => {
    const editor = document.querySelector('[aria-label="Note body"]').editor;
    let start;
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text.includes(text)) start = pos + node.text.indexOf(text); });
    if (start === undefined) throw new Error(`Missing fixture text: ${text}`);
    editor.commands.setTextSelection(range ? { from: start, to: start + text.length } : start + 1);
    editor.view.focus();
    const node = editor.view.domAtPos(start).node;
    (node.nodeType === Node.TEXT_NODE ? node.parentElement : node).scrollIntoView({ block: "center" });
  }, { text, range });
};
await selectText("Un poco de espacio", true);
await toolbar.getByRole("button", { name: "Named styles", exact: true }).click();
await shot("40-styles-tray");
await page.getByRole("region", { name: "Named styles tray" }).getByRole("button", { name: "Palabra", exact: true }).click();
await shot("41-style-selection");
await selectText("Fin de la muestra.");
await toolbar.getByRole("button", { name: "Named styles", exact: true }).click();
await page.getByRole("region", { name: "Named styles tray" }).getByRole("button", { name: "Heading", exact: true }).click();
await shot("42-style-whole-line");
await toolbar.getByRole("button", { name: "Named styles", exact: true }).click();
await button("Save this look as a style…").click();
await shot("43-save-this-look");
await page.getByLabel("Name", { exact: true }).fill("Mi muestra");
await page.getByRole("switch", { name: "Button in the toolbar" }).check();
await shot("44-save-this-look-options");
await button("Save").click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
await toolbar.getByRole("button", { name: "Mi muestra", exact: true }).scrollIntoViewIfNeeded();
await shot("45-style-toolbar-button");
await selectText("Una palabra para recordar.");
await toolbar.getByRole("button", { name: "Format painter", exact: true }).click();
await shot("46-painter-armed");
await selectText("Fin de la muestra.", true);
await button("Apply format").waitFor();
await shot("47-painter-apply-popup");
await checkPopup();
await button("Apply format").click();
await shot("48-painter-applied");
await back();
await button("Settings").click();
await button("Named styles").click();
await shot("49-named-styles-settings");
await button("Reset").click();
await shot("61-reset-named-styles");
await button("Cancel").click();
await button("+ New style").click();
await shot("50-new-style");
await page.getByLabel("Size", { exact: true }).selectOption("other");
await page.getByLabel("Other size (pt)").fill("72");
await page.getByLabel("Name", { exact: true }).fill("Una muestra con nombre largo para probar");
await page.getByLabel("Line", { exact: true }).scrollIntoViewIfNeeded();
await shot("51-new-style-options");
await button("Cancel").click();
await button("Heading").click();
await shot("52-edit-style");
await page.getByLabel("Line", { exact: true }).scrollIntoViewIfNeeded();
await shot("53-edit-style-options");
await button("Cancel").click();
await back();

// Phase 2e: generated image, node selection, viewer and the real hidden picker input.
await button("Toolbar").click();
await button("+ Add buttons").click();
await button("Add Image").click();
await button("Done").click();
await back(); await back();
await button("Captura de ejemplo").click();
await page.locator(".note-image img").waitFor({ state: "visible" });
await page.locator(".note-image").evaluate((element) => element.scrollIntoView({ block: "center" }));
await shot("55-image-note");
await page.locator(".note-image").click();
await button("View").waitFor();
await shot("56-image-selected");
await checkPopup();
await button("View").click();
await page.locator(".image-viewer img").waitFor({ state: "visible" });
await shot("57-image-viewer-fit");
await button("Actual size").click();
await shot("58-image-viewer-actual");
// Android Back shares this overlay path; it must close the viewer without leaving the note.
await page.evaluate(() => history.back());
await page.getByRole("dialog").waitFor({ state: "hidden" });
await page.waitForFunction(() => history.state.notesNavigation.stack.at(-1).screen === "note");
const imagePath = `private-data/phase-2e-generated-upload-${viewport.width}-${viewport.height}.png`;
writeFileSync(imagePath, makePng(720, 405));
await page.getByLabel("Note body").locator("p").last().click();
await page.keyboard.press("End");
await toolbar.getByRole("button", { name: "Image", exact: true }).click();
try {
  await page.getByLabel("Add images").setInputFiles(imagePath);
  await page.waitForFunction(() => document.querySelectorAll(".note-image").length === 2 &&
    [...document.querySelectorAll(".note-image img")].every((img) => img.complete && img.naturalWidth > 0));
} finally { unlinkSync(imagePath); }
await page.locator(".note-image").last().evaluate((element) => element.scrollIntoView({ block: "center" }));
await shot("59-image-inserted");
await back();
await button("Settings").click();
await page.getByText(/^Images: 2,/).scrollIntoViewIfNeeded();
await shot("60-settings-images");
// Phase 3a settings, before the destructive database-guard shots below.
await page.evaluate(() => window.scrollTo(0, 0));
await shot("62-settings-claude-row");
await button("Claude Off").click();
await shot("63-claude-off");
await page.getByRole("checkbox", { name: "I have set a monthly spend limit in the Anthropic console" }).check();
await page.getByLabel("Anthropic API key", { exact: true }).fill("sk-ant-FAKE-KEY-FOR-SCREENSHOTS");
await shot("64-claude-acknowledged");
await button("Save key and turn on").click();
await page.getByText("On · key saved on this phone", { exact: true }).waitFor();
await shot("65-claude-on");
await button("Test key").click();
await page.getByText("The key works.", { exact: true }).waitFor();
await shot("66-claude-key-works");
await button("Remove key").click();
await shot("67-claude-remove-key");
await page.getByRole("dialog").getByRole("button", { name: "Remove key", exact: true }).click();
await page.getByRole("checkbox", { name: "I have set a monthly spend limit in the Anthropic console" }).check();
await page.getByLabel("Anthropic API key", { exact: true }).fill("sk-ant-FAKE-REJECTED");
await button("Save key and turn on").click();
await page.getByText("On · key saved on this phone", { exact: true }).waitFor();
await button("Test key").click();
await page.getByText("Anthropic rejected this key.", { exact: true }).waitFor();
await shot("68-claude-key-rejected");
await back();
await back();
// Start 3b from the exact sample order (earlier shots deliberately edited/trashed notes).
await button("Settings").click();
await page.getByLabel("Import backup").setInputFiles(sample);
await button("Replace notebook").click();
const askImportDownload = page.waitForEvent("download");
await button("Import and replace").click(); await askImportDownload;
await page.getByText(/^Backup imported\./).waitFor(); await back();
await shot("69-notes-ask-claude");
await button("Ask Claude").click();
await shot("70-ask-empty");
const askDialog = () => page.getByRole("dialog", { name: "Send to Anthropic?" });
const release = async (count) => page.evaluate((count) => {
  if (count === null) { while (window.__claudeStreams.at(-1).release()) { /* finish fixture */ } }
  else for (let i = 0; i < count; i++) window.__claudeStreams.at(-1).release();
}, count ?? null);
const newQuestion = async () => {
  await button("New question").click(); await button("Clear conversation").click();
  await page.getByLabel("Your question").waitFor();
};
const beginAsk = async (question) => {
  await page.getByLabel("Your question").fill(question); await button("Send").click(); await askDialog().waitFor();
};
const sendDisclosed = async () => {
  const count = await page.evaluate(() => window.__claudeStreams.length);
  await askDialog().getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction((count) => window.__claudeStreams.length > count, count);
};
await beginAsk("¿Qué tengo que repasar de español?");
await shot("71-ask-disclosure");
await sendDisclosed(); await release(3);
await page.getByText(/^Claude is thinking/).waitFor(); await shot("72-ask-thinking");
await release(2); await page.locator("article").getByText(/^Repasa/).waitFor(); await shot("73-ask-streaming");
await release(); await page.getByLabel("Follow-up question").waitFor(); await shot("74-ask-answer-sources");
await page.getByRole("button", { name: /^1\. Frases para repasar/ }).click();
await page.getByLabel("Note body").waitFor(); await shot("75-ask-source-note");
// Make a second protected visit, then Back twice returns to the conversation.
await page.locator('a[href^="note:"]').filter({ hasText: "la nota de gramática" }).click();
await page.waitForFunction(() => document.querySelector('input[aria-label="Title"]')?.value === "Gramática — ser y estar");
await page.getByLabel("Title", { exact: true }).fill("Gramática — ser y estar editada");
await back(); await back();
await page.getByText("Edited since Claude read it", { exact: true }).waitFor(); await shot("76-ask-source-edited");
await page.getByLabel("Follow-up question").fill("¿Me das un ejercicio?");
await page.getByLabel("Follow-up question").scrollIntoViewIfNeeded(); await shot("77-ask-followup-estimate");
const followCount = await page.evaluate(() => window.__claudeStreams.length);
await page.getByRole("button", { name: /^Send · about/ }).click();
await page.waitForFunction((count) => window.__claudeStreams.length > count, followCount);
await release(); await page.locator('article[aria-label="Turn 2"]').getByText(/Opus 5.5/).waitFor();
await page.locator('article[aria-label="Turn 2"]').scrollIntoViewIfNeeded(); await shot("78-ask-followup-answer");
await newQuestion(); await beginAsk("¿Qué repasar?"); await sendDisclosed(); await release(5);
await page.locator("article").getByText(/^Repasa/).waitFor();
await button("Cancel").click(); await page.getByText("Stopped", { exact: true }).waitFor(); await shot("79-ask-stopped");
for (const [marker, name, expected] of [
  ["refusal", "80-ask-refusal", "Claude declined to answer this."],
  ["cut", "81-ask-cut-short", "Cut short"],
  ["overloaded", "82-ask-overloaded", "Anthropic is busy. Try again shortly."],
]) {
  await newQuestion(); await beginAsk(`[shot:${marker}]`); await sendDisclosed(); await release();
  await page.getByText(expected, { exact: true }).waitFor(); await shot(name);
}
await newQuestion(); await page.getByLabel("Your question").fill("¿Qué repasar?");
await context.setOffline(true); await page.getByText("You're offline. Claude needs a connection.", { exact: true }).waitFor();
if (await button("Send").isEnabled()) throw new Error("Offline Send must be disabled");
await shot("83-ask-offline"); await context.setOffline(false);
await back(); await button("Captura de ejemplo").click(); await button("Claude").click();
await shot("84-note-claude-sheet"); await button("Ask about this note").click();
await beginAsk("Describe la captura"); await askDialog().getByRole("checkbox").click(); // ticks once the images are prepared
await page.getByText(/1 image prepared/).waitFor(); await shot("85-note-ask-images");
await sendDisclosed(); await release(); await page.getByLabel("Follow-up question").waitFor(); await shot("86-note-ask-answer");
await newQuestion(); await beginAsk("[shot:fallback]"); await sendDisclosed(); await release();
await page.getByText(/answered by Opus 4.8/).waitFor(); await shot("87-ask-fallback");
await newQuestion(); await back(); await back();
// Phase 3c: fixture-only proposals, partial approval, stale refusal and both Undo paths.
// The same script accepts width/height arguments: run at 412, 375, and reduced height.
const beginTidy = async (instruction, sheetShot = false) => {
  await button("Claude").click();
  await page.getByLabel("What should Claude do? Leave blank to fix mistakes and tidy the formatting.").fill(instruction);
  if (sheetShot) await shot("88-note-tidy-sheet");
  await button("Continue").click();
  const discardOther = page.getByRole("dialog", { name: "Discard Claude's other proposal?" });
  if (await discardOther.isVisible()) await button("Discard and continue").click();
  await askDialog().waitFor();
};
const finishTidy = async (name = /^Apply \d+ changes?$/) => { await sendDisclosed(); await release(); await page.getByRole("button", { name }).first().waitFor(); };
const applyTidy = async () => { await page.getByRole("button", { name: /^Apply \d+ changes?$/ }).click(); await page.getByText(/^Applied \d+ changes?\.$/).waitFor(); };
await button("Notas de clase").click();
await beginTidy("Fix accents and make the supplies a list. [shot:tidy-class]", true);
await shot("89-tidy-disclosure"); await sendDisclosed(); await release(2);
await page.getByText(/^Claude is working on a proposal/).waitFor(); await shot("90-tidy-working");
await release(); await button("Apply 3 changes").waitFor(); await shot("91-tidy-review-top");
// Each paragraph edited in place is its own change; the second turns into the list.
await page.locator('article[aria-label="Change 2 of 2"] .bg-blue-50 ul').scrollIntoViewIfNeeded();
await shot("92-tidy-list-change");
await page.getByRole("checkbox", { name: /^Tags:/ }).uncheck();
await button("Apply 2 changes").scrollIntoViewIfNeeded(); await shot("93-tidy-partial");
await applyTidy(); await shot("94-tidy-applied"); await back();
await page.getByLabel("Note body").waitFor(); await shot("95-note-after-tidy");
await page.goForward(); await button("Undo").click(); await page.getByText("Earlier version restored.", { exact: true }).waitFor();
await back(); await page.getByLabel("Note body").waitFor(); await shot("96-note-after-undo");
await beginTidy("[shot:tidy-class]"); await finishTidy(); await back();
await page.getByLabel("Title", { exact: true }).fill("Notas de clase editada");
await button("Claude's proposal is ready · Review").click();
await page.getByText("This note changed since Claude read it. Ask again.", { exact: true }).waitFor();
await shot("97-tidy-stale"); await button("Discard").click();
await page.getByLabel("Title", { exact: true }).fill("Notas de clase");
await beginTidy("[shot:tidy-class]"); await finishTidy(); await applyTidy(); await back();
await page.getByLabel("Title", { exact: true }).fill("Mis notas después de Claude");
await page.goForward(); await button("Undo").click();
await button("Restore the earlier versions as new notes").waitFor(); await shot("98-tidy-undo-conflict");
await button("Restore the earlier versions as new notes").click();
await page.getByText("Earlier versions restored as new notes.", { exact: true }).waitFor();
await back(); await back(); await button("Notas de clase (before Claude)").waitFor(); await shot("99-tidy-earlier-copy");
await button("Captura de ejemplo").click(); await beginTidy("Remove the image. [shot:tidy-image]"); await finishTidy();
await page.getByText("Removes an image", { exact: true }).scrollIntoViewIfNeeded(); await shot("100-tidy-image-removal");
await button("Discard").click(); await back();
await button("Notas de clase (before Claude)").click(); await beginTidy("[shot:tidy-class]"); await sendDisclosed();
await back(); await back(); await release(); await button("Claude's proposal is ready · Review").waitFor(); await shot("101-tidy-ready-bar");
await button("Claude's proposal is ready · Review").click(); await button("Discard").click();
for (const [marker, name, expected] of [
  ["invalid", "102-tidy-invalid", "Claude's proposal couldn't be used; nothing was changed."],
  ["cut", "103-tidy-cut-short", "The proposal was cut short; nothing was changed."],
  ["refusal", "105-tidy-refusal", "Claude declined to answer this."],
]) {
  await button("Notas de clase (before Claude)").click(); await beginTidy(`[shot:tidy-${marker}]`);
  await sendDisclosed(); await release(); await page.getByText(expected, { exact: true }).waitFor(); await shot(name);
  await button("Discard").click(); await back();
}
await button("Notas de clase (before Claude)").click(); await beginTidy("[shot:tidy-class]"); await finishTidy(); await applyTidy();
await back(); await back(); await button("Settings").click(); await button("Claude On").click();
await button("Undo Claude's last change").waitFor(); await button("Undo Claude's last change").scrollIntoViewIfNeeded(); await shot("104-claude-settings-undo");
await back(); await back();
// Phase 3d: restore stable fixture handles after the earlier edits and copies.
await button("Settings").click(); await page.getByLabel("Import backup").setInputFiles(sample);
await button("Replace notebook").click();
const reorganiseImportDownload = page.waitForEvent("download");
await button("Import and replace").click(); await reorganiseImportDownload;
await page.getByText(/^Backup imported\./).waitFor(); await back();
await button("Ask Claude").click(); await shot("109-ask-tidy-notebook");
const beginReorganise = async (takeShots = false) => {
  await button("Tidy the notebook").click();
  if (takeShots) await shot("110-tidy-notebook-sheet");
  await button("Titles, tags and folders").click();
  const discardOther = page.getByRole("dialog", { name: "Discard Claude's other proposal?" });
  if (await discardOther.isVisible()) await button("Discard and continue").click();
  await askDialog().waitFor();
};
await beginReorganise(true); await shot("111-reorganise-disclosure"); await finishTidy();
await page.evaluate(() => window.scrollTo(0, 0)); await shot("112-reorganise-review-top");
const reminderCard = page.getByRole("article", { name: "Recordatorio suelto", exact: true });
await reminderCard.scrollIntoViewIfNeeded(); await shot("113-reorganise-three-rows");
const shoppingCard = page.getByRole("article", { name: "Compras", exact: true });
await shoppingCard.scrollIntoViewIfNeeded(); await shot("114-reorganise-new-folder");
await reminderCard.getByRole("checkbox", { name: /^Tags:/ }).uncheck();
await reminderCard.scrollIntoViewIfNeeded(); await shot("115-reorganise-row-unticked");
await applyTidy(); await back(); await back();
await button("Cuaderno para la biblioteca").waitFor(); await shot("116-reorganise-list-applied");
await page.goForward(); await page.goForward(); await button("Undo").click();
await page.getByText("Earlier version restored.", { exact: true }).waitFor(); await shot("117-reorganise-undo");
await back(); await beginReorganise(); await finishTidy(); await applyTidy(); await back(); await back();
await button("Cuaderno para la biblioteca").click(); await page.getByLabel("Title", { exact: true }).fill("Mi recordatorio después de Claude"); await back();
await button("Settings").click(); await button("Claude On").click(); await button("Undo Claude's last change").click();
await page.getByRole("dialog", { name: "Undo Claude's last change?" }).getByRole("button", { name: "Undo", exact: true }).click();
await button("Undo the 4 unchanged notes").waitFor(); await button("Undo the 4 unchanged notes").scrollIntoViewIfNeeded(); await shot("118-reorganise-partial-undo-offer");
await button("Undo the 4 unchanged notes").click(); await page.getByText(/^Restored 4 unchanged notes\./).waitFor(); await shot("119-reorganise-partial-undo-result");
await back(); await back(); await button("Mi recordatorio después de Claude").waitFor(); await shot("120-reorganise-list-after-partial-undo");
await button("Ask Claude").click(); await beginReorganise(); await finishTidy(); await back(); await back();
await button("Mi recordatorio después de Claude").click(); await page.getByLabel("Title", { exact: true }).fill("Otra edición");
await button("Claude's proposal is ready · Review").click();
await page.getByText("Some notes changed since Claude read them. Ask again.", { exact: true }).waitFor(); await shot("121-reorganise-stale");
await button("Discard").click(); await back();
// Phase 3e: reimport for stable handles; all requests still use the fail-closed fixture guard.
await button("Settings").click(); await page.getByLabel("Import backup").setInputFiles(sample);
await button("Replace notebook").click();
const linksImportDownload = page.waitForEvent("download");
await button("Import and replace").click(); await linksImportDownload;
await page.getByText(/^Backup imported\./).waitFor(); await back(); await button("Ask Claude").click();
const beginLinks = async (takeShots = false) => {
  await button("Tidy the notebook").click();
  if (takeShots) await shot("122-links-tidy-sheet");
  await button("Links between notes").click();
  const discardOther = page.getByRole("dialog", { name: "Discard Claude's other proposal?" });
  if (await discardOther.isVisible()) await button("Discard and continue").click();
  await askDialog().waitFor();
};
await beginLinks(true); await shot("123-links-disclosure"); await finishTidy();
await page.evaluate(() => window.scrollTo(0, 0)); await shot("124-links-review-top");
const classLinks = page.getByRole("article", { name: "Ideas para la próxima clase", exact: true });
await page.getByRole("article", { name: "Recordatorio suelto", exact: true }).scrollIntoViewIfNeeded(); await shot("125-links-both-placements");
await classLinks.scrollIntoViewIfNeeded();
await classLinks.getByRole("checkbox", { name: "→ Gramática — ser y estar", exact: true }).uncheck();
await shot("126-links-row-unticked"); await applyTidy(); await shot("127-links-applied");
await back(); await back(); await button("Ideas para la próxima clase").click();
await page.getByLabel("Note body").getByRole("link", { name: "Frases útiles", exact: true }).waitFor(); await shot("128-links-inline-note");
await page.getByLabel("Note body").getByText(/^See also:/).scrollIntoViewIfNeeded(); await shot("129-links-see-also-note");
await page.getByLabel("Note body").getByRole("link", { name: "Frases útiles", exact: true }).click();
// The new link must appear under "Linked from" on the target.
await page.getByRole("region", { name: "Linked from" }).getByText("Ideas para la próxima clase", { exact: true }).scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, 300)); await shot("130-links-backlinks"); // clear of the toolbar
await back(); await back(); await button("Settings").click(); await button("Claude On").click();
await button("Undo Claude's last change").click();
await page.getByRole("dialog", { name: "Undo Claude's last change?" }).getByRole("button", { name: "Undo", exact: true }).click();
await page.getByText("Earlier version restored.", { exact: true }).waitFor(); await shot("131-links-clean-undo");
await back(); await back(); await button("Ask Claude").click(); await beginLinks(); await finishTidy(); await applyTidy(); await back(); await back();
await button("Ideas para la próxima clase").click(); await page.getByLabel("Title", { exact: true }).fill("Ideas para clase editadas"); await back();
await button("Settings").click(); await button("Claude On").click(); await button("Undo Claude's last change").click();
await page.getByRole("dialog", { name: "Undo Claude's last change?" }).getByRole("button", { name: "Undo", exact: true }).click();
await button("Undo the 4 unchanged notes").waitFor(); await button("Undo the 4 unchanged notes").scrollIntoViewIfNeeded(); await shot("132-links-partial-undo-offer");
await button("Undo the 4 unchanged notes").click(); await page.getByText(/^Restored 4 unchanged notes\. Left as they are \(their links stay\):/).waitFor(); await shot("133-links-partial-undo-result");
await back(); await back(); await button("Ask Claude").click(); await beginLinks(); await finishTidy(); await back(); await back();
await button("Lista de lecturas").click(); await page.getByLabel("Title", { exact: true }).fill("Lista de lecturas editada");
await button("Claude's proposal is ready · Review").click();
await page.getByText("Some notes changed since Claude read them. Ask again.", { exact: true }).waitFor(); await shot("134-links-stale");
await button("Discard").click(); await back();
// Phase 3f: a fresh public sample makes group handles, backlinks and Undo reproducible.
await button("Settings").click(); await page.getByLabel("Import backup").setInputFiles(sample);
await button("Replace notebook").click();
const moveImportDownload = page.waitForEvent("download"); await button("Import and replace").click(); await moveImportDownload;
await page.getByText(/^Backup imported\./).waitFor(); await back(); await button("Ask Claude").click();
const beginDuplicates = async (takeShots = false) => {
  await button("Tidy the notebook").click(); if (takeShots) await shot("135-merge-tidy-sheet");
  await button("Find duplicates to merge").click();
  if (await page.getByRole("dialog", { name: "Discard Claude's other proposal?" }).isVisible()) await button("Discard and continue").click();
  await askDialog().waitFor();
};
const selectReadingMerge = async () => {
  await page.getByRole("article", { name: "Suggested merge 1" }).getByRole("button", { name: "Merge 2 notes…" }).click(); await askDialog().waitFor();
};
const applyMerge = async () => { await button("Apply merge").click(); await page.getByText(/^Merged 2 notes into/).waitFor(); };
await beginDuplicates(true); await shot("136-duplicates-disclosure"); await finishTidy("Merge 2 notes…"); await shot("137-suggested-merges");
await selectReadingMerge(); await shot("138-merge-disclosure"); await finishTidy("Apply merge");
await page.evaluate(() => window.scrollTo(0, 0)); await shot("139-merge-review-top");
await page.getByText("Not in the merged note word for word:", { exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" })); await shot("140-merge-review-body");
await button("Apply merge").scrollIntoViewIfNeeded(); await shot("141-merge-review-bottom");
await applyMerge(); await button("Other suggested merges (1)").waitFor(); await shot("142-merge-applied");
await button("Open the merged note").click(); await page.getByLabel("Note body").waitFor(); await shot("143-merged-note");
await back(); await back(); await back(); await button("Trash (2)").click(); await page.getByText("Lista de lecturas", { exact: true }).waitFor(); await shot("144-merge-source-in-trash");
await back(); await button("Recordatorio suelto").click(); await page.getByLabel("Note body").getByRole("link", { name: "lista de lecturas" }).waitFor(); await shot("145-merge-backlink-note");
await page.getByLabel("Note body").getByRole("link", { name: "lista de lecturas" }).click();
// Wait for the navigation itself: the previous note's title field is still on screen at first.
await page.waitForFunction(() => document.querySelector('input[aria-label="Title"]')?.value === "Libros por leer", null, { timeout: 10000 })
  .catch(() => { throw new Error("Merge backlink did not open the kept note"); });
await shot("146-backlink-opens-merged-note"); await back(); await back();
await button("Settings").click(); await button("Claude On").click(); await button("Undo Claude's last change").click();
await page.getByRole("dialog", { name: "Undo Claude's last change?" }).getByRole("button", { name: "Undo", exact: true }).click();
await page.getByText("Merge undone.", { exact: true }).waitFor(); await shot("147-merge-clean-undo");
await back(); await back(); await button("Ask Claude").click(); await beginDuplicates(); await finishTidy("Merge 2 notes…"); await selectReadingMerge(); await finishTidy("Apply merge"); await applyMerge();
await button("Open the merged note").click(); await page.getByLabel("Title", { exact: true }).fill("Libros por leer editados"); await back();
await button("Undo").click(); await button("Undo, keeping later changes").waitFor(); await button("Undo, keeping later changes").scrollIntoViewIfNeeded(); await shot("148-merge-keep-edits-offer");
await button("Undo, keeping later changes").click(); await page.getByText("Undone, keeping later changes. Earlier content restored as copies where needed.").waitFor(); await shot("149-merge-keep-edits-result");
await button("Other suggested merges (2)").click(); await page.getByRole("article", { name: "Suggested merge 2" }).scrollIntoViewIfNeeded(); await shot("150-other-suggested-merges");
await back(); await back(); await button("Libros por leer (before Claude)").waitFor(); await button("Lista de lecturas").waitFor(); await shot("151-merge-copies-and-restored-source");
await button("Claude's suggestions are ready · Review").click(); await selectReadingMerge(); await finishTidy("Apply merge"); await back();
await button("Lista de lecturas").click(); await page.getByLabel("Title", { exact: true }).fill("Lista de lecturas editada"); await button("Claude's proposal is ready · Review").click();
await page.getByText("Some notes changed since Claude read them. Ask again.", { exact: true }).waitFor(); await shot("152-merge-stale");
await button("Discard").click(); await back(); await back();
await button("Vocabulario — comida").click(); await button("Claude").click(); await button("Split…").scrollIntoViewIfNeeded(); await shot("153-note-split-sheet");
await button("Split…").click();
if (await page.getByRole("dialog", { name: "Discard Claude's other proposal?" }).isVisible()) await button("Discard and continue").click();
await askDialog().waitFor(); await shot("154-split-disclosure"); await finishTidy("Apply split");
await page.evaluate(() => window.scrollTo(0, 0)); await shot("155-split-review-keeps");
await page.getByRole("article", { name: "En el restaurante" }).scrollIntoViewIfNeeded(); await shot("156-split-review-new-note");
await button("Apply split").click(); await page.getByText("Split into 1 new note.", { exact: true }).waitFor(); await shot("157-split-applied");
await button("Open the note").click(); await page.getByLabel("Note body").getByText(/^Split into:/).scrollIntoViewIfNeeded(); await shot("158-split-original-links");
await page.getByLabel("Note body").getByRole("link", { name: "En el restaurante" }).click(); await page.getByLabel("Note body").waitFor(); await shot("159-split-new-note");
await back(); await back(); await button("Undo").click(); await page.getByText("Split undone.", { exact: true }).waitFor(); await shot("160-split-clean-undo");
await back();
// Only this fresh browser context's fixture notebook is involved in the guard screenshots.
await page.evaluate(() => {
  const channel = new BroadcastChannel("notes_app");
  channel.postMessage({ type: "notebook-replaced", generation: "screenshot-fixture" });
  channel.close();
});
await page.getByText(/^The notebook was replaced in another window/).first().waitFor();
await shot("16-notebook-replaced");
await page.reload({ waitUntil: "networkidle" });
await page.getByLabel("Note body").waitFor();
await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("notes_app", 50);
  request.onsuccess = () => { request.result.close(); resolve(); };
  request.onerror = () => reject(request.error);
}));
await page.getByText("The app was updated in another window. Reload to keep editing.").waitFor();
await shot("17-database-updated");
await page.reload({ waitUntil: "networkidle" });
await page.getByText("This notebook was updated by a newer version of the app. Reload to update.").waitFor();
await shot("18-read-only-note");
await back();
await button("Settings").click();
await shot("19-read-only-settings");

await browser.close();
if (unexpectedAnthropic.length) throw new Error(`Unexpected request to Anthropic: ${unexpectedAnthropic.join(", ")}`);
