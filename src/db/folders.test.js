import { beforeEach, expect, it } from "vitest";
import { createFolder, renameFolder, reorderFolders, deleteFolder, allFolders } from "./folders.js";
import { createNote, trashNote, getNote } from "./notes.js";
import { resetDatabase } from "../test/fixtures.js";

beforeEach(resetDatabase);
it("creates, trims, renames and reorders folders", async () => {
  const a = await createFolder(" A ");
  const b = await createFolder("B");
  expect(a).toMatchObject({ name: "A", position: 0 });
  expect(b.position).toBe(1);
  await renameFolder(a.id, " New A ");
  await reorderFolders([b.id, a.id]);
  expect((await allFolders()).map(({ id, name, position }) => [id, name, position])).toEqual([[b.id, "B", 0], [a.id, "New A", 1]]);
});
it("deleting a folder moves live and trashed notes to null without changing recency", async () => {
  const folder = await createFolder("Folder");
  const live = await createNote({ folderId: folder.id });
  const trashed = await createNote({ folderId: folder.id });
  const untouched = await createNote();
  await trashNote(trashed.id);
  await deleteFolder(folder.id);
  expect(await allFolders()).toEqual([]);
  expect(await getNote(live.id)).toMatchObject({ folderId: null, rev: 2, updatedAt: live.updatedAt });
  expect(await getNote(trashed.id)).toMatchObject({ folderId: null, rev: 3, updatedAt: trashed.updatedAt });
  expect(await getNote(untouched.id)).toEqual(untouched);
});
it("refuses invalid names and incomplete/duplicate/unknown reorder lists without changing folders", async () => {
  const a = await createFolder("A");
  const b = await createFolder("B");
  await expect(createFolder(" ")).rejects.toThrow();
  await expect(renameFolder(a.id, null)).rejects.toThrow();
  await expect(renameFolder("missing", "Name")).rejects.toThrow();
  for (const ids of [[a.id], [a.id, a.id], [a.id, "missing"]]) await expect(reorderFolders(ids)).rejects.toThrow();
  expect(await allFolders()).toEqual([a, b]);
});
