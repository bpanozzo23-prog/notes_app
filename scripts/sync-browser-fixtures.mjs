// Shared fixture/UI steps only. No app hooks and no owner data.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export const button = (page, name) => page.getByRole("button", { name, exact: true });
export const confirmation = (page) => page.getByRole("heading", { name: "The XPS copy has notes this phone doesn't", exact: true });
export const unreachable = "Couldn't reach the XPS. Check that Tailscale is on. Trying again shortly.";

// Only for screen navigation with no open overlay (Back closes overlays first).
export async function backFromScreen(page) {
  const heading = page.getByRole("heading", { level: 1 });
  const previous = await heading.textContent();
  await button(page, "Back").click();
  await page.getByRole("heading", { level: 1, name: previous, exact: true }).waitFor({ state: "hidden" });
}

export async function until(label, read, accepts, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (accepts(value)) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}

export function changedSample(sample) {
  const backup = structuredClone(sample);
  const edited = backup.notes.find((note) => note.deletedAt === null && note.title && !note.html.includes("<img"));
  const removed = backup.notes.find((note) => note.deletedAt !== null);
  assert.ok(edited && removed, "sample needs a text note and a note in Trash");
  edited.html += "<p>Imported sync fixture change.</p>";
  edited.text += "\nImported sync fixture change.";
  backup.notes = backup.notes.filter((note) => note.id !== removed.id);
  // Deliberately no tombstone: the cross-generation confirmation must protect the old copy.
  return { backup, edited, removed };
}

export async function importPreview(page, backup) {
  await page.getByLabel("Import backup", { exact: true }).setInputFiles(typeof backup === "string" ? backup : {
    name: "sample-sync-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByLabel("Import preview", { exact: true }).waitFor();
}

export async function acceptImport(page) {
  await button(page, "Replace notebook").click();
  const dialog = page.getByRole("dialog", { name: "Replace notebook?", exact: true });
  const safety = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Import and replace", exact: true }).click();
  await safety;
  await dialog.waitFor({ state: "hidden" });
  await page.getByLabel("Import preview", { exact: true }).waitFor({ state: "hidden" });
  await page.getByText(/^Backup imported\./).waitFor();
}

// The caller starts on Settings and remains there after the import.
export async function importNotebook(page, backup) {
  await importPreview(page, backup);
  await acceptImport(page);
}

export async function checkPreview(page, backup) {
  const preview = page.getByLabel("Import preview", { exact: true });
  const trash = backup.notes.filter((note) => note.deletedAt !== null).length;
  await preview.getByText(`${backup.notes.length} notes (${trash} in Trash), ${backup.folders.length} folders, ${backup.tombstones.length} deletion records.`, { exact: true }).waitFor();
  await preview.getByText(new RegExp(`^${backup.files.length} images? \\(`)).waitFor();
}

export async function waitSynced(page, backup) {
  await page.getByText(/^Connected · last synced /).waitFor();
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (backup) await page.getByText(`On the XPS: ${count(backup.notes.length, "note", "notes")}, ${count(backup.files.length, "picture", "pictures")}`, { exact: true }).waitFor();
  await until("Sync now becomes available", () => button(page, "Sync now").isEnabled(), Boolean);
}
