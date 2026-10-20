import { validateTitle } from "../claude/proposals.js";
import { assembleBody } from "../claude/diff.js";
import { nowIso } from "../lib/dates.js";

export function inboxPlan(cards, ticked, generation, editedTitles = {}, at = nowIso()) {
  const selected = ticked instanceof Set ? ticked : new Set(ticked);
  const plan = { kind: "xps", generation, notes: [], folderChecks: [], outbox: [] };
  const checkFolder = (folder) => {
    if (folder && !plan.folderChecks.some(({ id }) => id === folder.id)) plan.folderChecks.push({ id: folder.id, name: folder.name });
  };
  for (const card of cards) {
    if (card.stale || card.invalid) continue;
    const applied = card.ids.filter((id) => selected.has(id));
    if (!applied.length) continue;
    const patch = {};
    if (selected.has(card.ticks.title) && card.title !== null) patch.title = validateTitle(editedTitles[card.key] ?? card.title);
    if (selected.has(card.ticks.tags) && card.tags !== null) patch.tags = card.tags;
    if (selected.has(card.ticks.folder) && card.folder.action !== "keep") patch.folderId = card.folder.id ?? null;
    if (card.changes.some(({ id }) => id && selected.has(id))) patch.html = assembleBody(card.note.html, card.changes, selected);
    checkFolder(card.folders.find(({ id }) => id === card.note.folderId));
    if (selected.has(card.ticks.folder) && card.folder.action === "existing") checkFolder(card.folder);
    plan.notes.push({ id: card.note.id, expectedRev: card.version.basedOnRev, patch });
    plan.outbox.push({ proposal: card.version.proposal, hash: card.version.hash, outcome: "applied", applied, at });
  }
  return plan;
}
