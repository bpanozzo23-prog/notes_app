import { firstLine } from "./text.js";

export const noteTitle = (note) => note.title.trim() || firstLine(note.text) || "Untitled note";

export function tagsInUse(notes) {
  const counts = new Map();
  for (const note of notes) {
    for (const tag of new Set(note.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
}

export function visibleNotes(notes, filter) {
  return notes.filter((note) => filter?.type === "folder" ? note.folderId === filter.value :
    filter?.type === "tag" ? note.tags.includes(filter.value) : true)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
