// Shared fixture/UI steps only. No app hooks and no owner data.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";

export const button = (page, name) => page.getByRole("button", { name, exact: true });
export const confirmation = (page) => page.getByRole("heading", { name: "The XPS copy has notes this phone doesn't", exact: true });
export const unreachable = "Couldn't reach the XPS. Check that Tailscale is on. Trying again shortly.";
export const staleSuggestion = "You edited this note after Claude Code read it, so this suggestion can't be applied. Keep both adds Claude Code's version as a separate note.";

// Callers pass only their temporary fixture view. Write exactly the files Claude Code writes;
// ingestion and hashes always belong to the real service, never fabricated browser state.
export async function writeProposalPair(viewDir, pid, note, generation, changes = {}) {
  assert.match(pid, /^p-[a-z0-9-]{3,80}$/);
  const { body = note.html, ...metadata } = changes;
  const details = { note: note.id, basedOnRev: note.rev, generation, title: note.title,
    folderId: note.folderId, tags: [...note.tags], why: "Make this fixture clearer.", ...metadata };
  await fs.writeFile(path.join(viewDir, `inbox/${pid}.html`), body);
  await fs.writeFile(path.join(viewDir, `inbox/${pid}.json`), JSON.stringify(details));
}
export async function writeNewNoteProposal(viewDir, pid, generation, fields) {
  assert.match(pid, /^p-[a-z0-9-]{3,80}$/);
  const { body, ...metadata } = fields;
  assert.equal(typeof body, "string");
  await fs.writeFile(path.join(viewDir, `inbox/${pid}.html`), body);
  await fs.writeFile(path.join(viewDir, `inbox/${pid}.json`), JSON.stringify({ generation, title: "", folderId: null, tags: [], why: "New fixture note.", ...metadata }));
}
export async function writeTrashProposal(viewDir, pid, note, generation, why) {
  assert.match(pid, /^p-[a-z0-9-]{3,80}$/);
  await fs.writeFile(path.join(viewDir, `inbox/${pid}.json`), JSON.stringify({ note: note.id, basedOnRev: note.rev, generation, trash: true, why }));
}

export async function writeReviewFixtures(viewDir, snapshot) {
  const find = (title) => {
    const note = snapshot.notes.find((note) => note.title === title && note.deletedAt === null);
    assert.ok(note, `sample needs ${title}`); return note;
  };
  const text = find("Notas de clase"), metadata = find("Ideas para la próxima clase"), stale = find("Lista de lecturas");
  const generation = snapshot.meta.generation;
  await writeProposalPair(viewDir, "p-phone-001-text", text, generation, {
    title: "Notas de clase — revisadas", why: "Fixed accents in the first paragraph and made the title clearer.",
    body: text.html.replace("ojala que tu vengas", "Ojalá que tú vengas").replace("recivir", "recibir").replace("<p>", '<p style="text-align: justify">'),
  });
  await writeProposalPair(viewDir, "p-phone-002-metadata", metadata, generation, {
    tags: ["clase"], folderId: null, why: "Added the class tag and kept this plan outside a folder.",
  });
  await writeProposalPair(viewDir, "p-phone-003-stale", stale, generation, {
    body: stale.html.replace("Ficciones.", "Ficciones de Borges."), why: "Added the author's name.",
  });
  const picture = find("Captura de ejemplo"), trash = find("Recordatorio suelto");
  const image = picture.html.match(/<img\b[^>]*\bdata-file=[^>]*>/i)?.[0];
  assert.ok(image, "sample needs a referenced picture");
  const newNote = { title: "Recetas de la semana", newFolder: "Recetas", tags: ["cocina"],
    body: `<h2>Recetas de la semana</h2><p>Preparar verduras y arroz.</p>${image}`, why: "Collect the week's recipes with the existing example picture." };
  await writeNewNoteProposal(viewDir, "p-phone-004-new", generation, newNote);
  await writeTrashProposal(viewDir, "p-phone-005-trash", trash, generation, "This loose reminder is finished.");
  return { text, metadata, stale, newNote, trash };
}

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
