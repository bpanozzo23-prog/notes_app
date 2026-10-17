// Render the app in headless Chromium at phone size and save screenshots, so an agent can see
// the layout without the owner's phone. Usage:
//   node scripts/screenshot.mjs [out-dir] [url]
// Defaults: out-dir private-data/shots (gitignored), url http://localhost:5174/notes_app/
// (the dev server; pass https://bpanozzo23-prog.github.io/notes_app/ for the published app).
// Storage is fresh on every run; the made-up public/sample-notebook.json is imported through
// the app's own Settings → Import flow. Nothing from the owner's notes is involved.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const out = process.argv[2] ?? "private-data/shots";
const url = process.argv[3] ?? "http://localhost:5174/notes_app/";
const sample = fileURLToPath(new URL("../public/sample-notebook.json", import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
// Pixel 7 is the closest built-in profile to the owner's S25 Ultra: 412 px wide, 2.6x, touch.
const context = await browser.newContext({ ...devices["Pixel 7"], locale: "en-GB" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("pageerror:", error.message));
page.on("console", (message) => { if (["error", "warning"].includes(message.type())) console.log(`console.${message.type()}:`, message.text()); });

const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png` }); console.log(`${out}/${name}.png`); };
const button = (name) => page.getByRole("button", { name, exact: true });
const back = () => button("Back").click();

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
await page.getByText("Imported").first().waitFor().catch(() => {});
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
await page.mouse.wheel(0, 1200);
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

await browser.close();
