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
  const request = indexedDB.open("notes_app", 30);
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
