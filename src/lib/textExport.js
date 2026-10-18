import { noteToClaudeText } from "../claude/projection.js";
import { noteTitle, visibleNotes } from "./notebookView.js";

// Match Claude's context dates: absolute days in English, in the device's time zone.
const date = (value) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const lookupNotes = (notes) => new Map(notes.filter((note) => note.deletedAt === null).map((note) => [note.id, note]));

function noteBlock(note, lookup, level, folder) {
  const metadata = [
    ...(folder === undefined ? [] : [`Folder: ${folder}`]),
    ...(note.tags.length ? [`Tags: ${note.tags.join(", ")}`] : []),
    `Created ${date(note.createdAt)}`, `Edited ${date(note.updatedAt)}`,
    ...(note.pinned ? ["Pinned"] : []),
  ].join(" · ");
  const body = noteToClaudeText(note.html, lookup, { headingOffset: level }) || "(empty note)";
  return `${"#".repeat(level)} ${noteTitle(note)}\n${metadata}\n\n${body}`;
}

export function notebookToText({ notes, folders, now }) {
  const live = visibleNotes(notes.filter((note) => note.deletedAt === null));
  const lookup = lookupNotes(live);
  const exported = new Date(now);
  const time = exported.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sections = [
    `# Notes — exported ${date(exported)}, ${time}\n${live.length} ${live.length === 1 ? "note" : "notes"}. Made by notes_app. Pictures appear as [image]; links between notes as "text [→ Title]".`,
  ];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const groups = [...folders].sort((a, b) => a.position - b.position).map((folder) => ({
    name: folder.name, notes: live.filter((note) => note.folderId === folder.id),
  }));
  // An orphaned folder reference still exports its note, under No folder.
  groups.push({ name: "No folder", notes: live.filter((note) => !folderIds.has(note.folderId)) });
  for (const group of groups) {
    if (group.notes.length) sections.push(`## ${group.name}\n\n${group.notes.map((note) => noteBlock(note, lookup, 3)).join("\n\n")}`);
  }
  return `${sections.join("\n\n")}\n`;
}

export function noteToText(note, folders, notes) {
  return `${noteBlock(note, lookupNotes(notes), 1, folders.find((folder) => folder.id === note.folderId)?.name ?? "No folder")}\n`;
}
