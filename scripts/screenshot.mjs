// Render the app in headless Chromium at phone size and save screenshots, so an agent can see
// the layout without the owner's phone. Usage:
//   node scripts/screenshot.mjs [out-dir] [url]
// Defaults: out-dir private-data/shots (gitignored), url http://localhost:5174/notes_app/
// (the dev server; pass https://bpanozzo23-prog.github.io/notes_app/ for the published app).
// Storage is fresh on every run: nothing from the owner's notes is involved.
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";

const out = process.argv[2] ?? "private-data/shots";
const url = process.argv[3] ?? "http://localhost:5174/notes_app/";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
// Pixel 7 is the closest built-in profile to the owner's S25 Ultra: 412 px wide, 2.6x, touch.
const context = await browser.newContext({ ...devices["Pixel 7"], locale: "en-GB" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("pageerror:", error.message));
page.on("console", (message) => { if (["error", "warning"].includes(message.type())) console.log(`console.${message.type()}:`, message.text()); });

const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png` }); console.log(`${out}/${name}.png`); };

await page.goto(url, { waitUntil: "networkidle" });
await shot("01-list-empty");

await page.getByRole("button", { name: "+ New note" }).click();
await page.getByLabel("Title").fill("Vocabulario");
await page.getByLabel("Note body").click();
await page.keyboard.type("## Comida\n- manzana — apple\n- el niño come **pan**\n\n[] Repasar mañana");
await page.getByLabel("Add tag").fill("spanish");
await page.keyboard.press("Enter");
await shot("02-note-typed");

await page.getByLabel("Note body").click();
await page.keyboard.press("Control+A");
await shot("03-selection-menu");

await page.getByRole("button", { name: "Link to note" }).first().click();
await shot("04-link-picker-empty");
await page.getByRole("button", { name: "Cancel" }).click();

await page.getByRole("button", { name: "Back", exact: true }).click();
await page.getByRole("button", { name: "+ New note" }).click();
await page.getByLabel("Note body").click();
await page.keyboard.type("Lista de libros. ");
await page.getByRole("button", { name: "Link to note" }).first().click();
await page.getByRole("button", { name: "Vocabulario", exact: true }).click();
await shot("05-note-with-link");

await page.getByRole("button", { name: "Back", exact: true }).click();
await shot("06-list-two-notes");
await page.getByLabel("Search notes").fill("nino");
await shot("07-search");
await page.getByRole("button", { name: "Clear search" }).click();
await page.getByRole("button", { name: "Vocabulario", exact: true }).click();
await shot("08-linked-from");

await page.getByRole("button", { name: "Back", exact: true }).click();
await page.getByRole("button", { name: "Settings" }).click();
await shot("09-settings");
await page.getByRole("button", { name: "Back", exact: true }).click();
await page.getByRole("button", { name: "Folders" }).click();
await shot("10-folders");

await browser.close();
