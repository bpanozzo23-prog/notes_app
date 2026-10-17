import { db, writeTransaction } from "./db.js";
import { newId } from "../lib/ids.js";

function cleanName(name) {
  if (typeof name !== "string" || !name.trim()) throw new Error("Folder name cannot be empty");
  return name.trim();
}

export async function createFolder(name) {
  const folder = { id: newId(), name: cleanName(name), position: 0 };
  return writeTransaction([db.folders], async () => {
    const last = await db.folders.orderBy("position").last();
    folder.position = last ? last.position + 1 : 0;
    await db.folders.add(folder);
    return folder;
  });
}

export async function renameFolder(id, name) {
  return writeTransaction([db.folders], async () => {
    if (!(await db.folders.update(id, { name: cleanName(name) }))) throw new Error("Folder does not exist");
  });
}

export async function reorderFolders(ids) {
  return writeTransaction([db.folders], async () => {
    const folders = await db.folders.toArray();
    if (new Set(ids).size !== ids.length || ids.length !== folders.length ||
        folders.some((folder) => !ids.includes(folder.id))) throw new Error("Include every folder exactly once");
    await db.folders.bulkPut(folders.map((folder) => ({ ...folder, position: ids.indexOf(folder.id) })));
  });
}

export async function deleteFolder(id) {
  return writeTransaction([db.folders, db.notes], async () => {
    await db.notes.filter((note) => note.folderId === id).modify((note) => {
      note.folderId = null;
      note.rev += 1;
    });
    await db.folders.delete(id);
  });
}

export const allFolders = () => db.folders.orderBy("position").toArray();
