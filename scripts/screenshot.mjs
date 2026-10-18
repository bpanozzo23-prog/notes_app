// Render the app in headless Chromium at phone size and save screenshots, so an agent can see
// the layout without the owner's phone. Usage:
//   node scripts/screenshot.mjs [out-dir] [url] [width] [height]
// Defaults: out-dir private-data/shots (gitignored), url http://localhost:5174/notes_app/
// (the dev server; pass https://bpanozzo23-prog.github.io/notes_app/ for the published app).
// Storage is fresh on every run; the made-up public/sample-notebook.json is imported through
// the app's own Settings → Import flow. Nothing from the owner's notes is involved.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

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
const context = await browser.newContext({ ...devices["Pixel 7"], viewport, locale: "en-GB" });
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
await shot("01-list-empty");

// Import the sample notebook the way the owner would (the safety download is accepted silently).
await button("Settings").click();
await page.getByLabel("Import backup").setInputFiles(sample);
await button("Replace notebook").click();
await shot("02-import-confirm");
const download = page.waitForEvent("download");
await button("Import and replace").click();
await download;
await page.getByText(/^Backup imported\./).waitFor();
await shot("03-settings-after-import");
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
  ["Typeface", "typeface"], ["Line spacing", "spacing"], ["Callout", "callout"], ["Divider styles", "divider"]]) {
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

await back();
await button("Vocabulario — comida").click();
// Only this fresh browser context's fixture notebook is involved in the guard screenshots.
await page.evaluate(() => {
  const channel = new BroadcastChannel("notes_app");
  channel.postMessage({ type: "notebook-replaced", generation: "screenshot-fixture" });
  channel.close();
});
await page.getByText(/^The notebook was replaced in another window/).waitFor();
await shot("16-notebook-replaced");
await page.reload({ waitUntil: "networkidle" });
await page.getByLabel("Note body").waitFor();
await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("notes_app", 40);
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
