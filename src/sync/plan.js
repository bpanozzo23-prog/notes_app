import { validateTitle } from "../claude/proposals.js";
import { assembleBody, addedNoteLinks } from "../claude/diff.js";
import { extractNoteLinks } from "../lib/text.js";
import { noteTitle } from "../lib/notebookView.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/dates.js";
import { handledEntry } from "./inbox.js";

const usable = (card) => !card.stale && !card.invalid && !card.handledMessage;
function selectedBody(card, selected) {
  if (card.kind === "new") return selected.has(card.ids[0]) ? card.html : null;
  if (card.kind === "edit" && card.changes.some(({ id }) => id && selected.has(id))) return assembleBody(card.note.html, card.changes, selected);
  return null;
}
export function linkIntoTrashError(cards, selected) {
  const trashed = new Map(cards.filter((card) => usable(card) && card.kind === "trash" && selected.has(card.ids[0])).map((card) => [card.note.id, card.note]));
  for (const card of cards.filter(usable)) {
    const html = selectedBody(card, selected);
    if (html === null) continue;
    for (const id of card.kind === "edit" ? addedNoteLinks(card.note.html, html) : extractNoteLinks(html)) if (trashed.has(id)) {
      return `A ticked change links to “${noteTitle(trashed.get(id))}”, which you're moving to Trash. Untick one of them.`;
    }
  }
  return "";
}
export function inboxPlan(cards, ticked, generation, editedTitles = {}, at = nowIso()) {
  const selected = ticked instanceof Set ? ticked : new Set(ticked);
  const plan = { kind: "xps", generation, notes: [], createNotes: [], createFolders: [], expectedNewFolders: [], folderChecks: [], nameReuseChecks: [], outbox: [], handled: [] };
  const names = new Map();
  const checkFolder = (folder) => {
    if (folder && !plan.folderChecks.some(({ id }) => id === folder.id)) plan.folderChecks.push({ id: folder.id, name: folder.name });
    if (folder?.byName && !plan.nameReuseChecks.some(({ id }) => id === folder.id)) plan.nameReuseChecks.push({ id: folder.id, name: folder.name });
  };
  const folderId = (folder) => {
    if (folder.action === "existing") { checkFolder(folder); return folder.id; }
    if (folder.action !== "create") return null;
    const key = folder.name.toLowerCase();
    if (!names.has(key)) {
      names.set(key, folder.name); plan.createFolders.push({ name: folder.name }); plan.expectedNewFolders.push(folder.name);
    }
    return { create: names.get(key) };
  };
  for (const card of cards) {
    if (!usable(card)) continue;
    const applied = card.ids.filter((id) => selected.has(id));
    if (!applied.length) continue;
    if (card.kind === "new") plan.createNotes.push({ id: newId(), title: validateTitle(editedTitles[card.key] ?? card.title), html: card.html, tags: card.tags, folderId: folderId(card.folder) });
    else {
      checkFolder(card.folders.find(({ id }) => id === card.note.folderId));
      if (card.kind === "trash") plan.notes.push({ id: card.note.id, expectedRev: card.version.basedOnRev, role: "trashed", patch: { deletedAt: at } });
      else {
        const patch = {};
        if (selected.has(card.ticks.title) && card.title !== null) patch.title = validateTitle(editedTitles[card.key] ?? card.title);
        if (selected.has(card.ticks.tags) && card.tags !== null) patch.tags = card.tags;
        if (selected.has(card.ticks.folder) && card.folder.action !== "keep") patch.folderId = folderId(card.folder);
        if (card.folder.action === "keep" && card.resolvedFolder?.byName) checkFolder(card.resolvedFolder);
        const html = selectedBody(card, selected);
        if (html !== null) patch.html = html;
        plan.notes.push({ id: card.note.id, expectedRev: card.version.basedOnRev, patch });
      }
    }
    plan.outbox.push({ proposal: card.version.proposal, hash: card.version.hash, outcome: "applied", applied, at });
    plan.handled.push(handledEntry(card.version, generation, "applied"));
  }
  return plan;
}
export function keepBothPlan(model, at = nowIso()) {
  return { kind: "xps", generation: model.generation, notes: [],
    createNotes: [{ id: newId(), title: model.title, html: model.html, tags: model.tags, folderId: model.folder.id ?? null }],
    folderChecks: model.folderChecks, sourceCheck: model.sourceCheck, linkChecks: model.linkChecks, fileChecks: model.fileChecks,
    outbox: [{ proposal: model.version.proposal, hash: model.version.hash, outcome: "kept", applied: [], at }],
    handled: [handledEntry(model.version, model.generation, "kept")] };
}
