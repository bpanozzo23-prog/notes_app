// @vitest-environment node
import { expect, it } from "vitest";
import { note } from "./test-support.js";
import { proposalKind, proposalProblem, referenceProblem } from "./proposals.mjs";

const details = {
  edit: { note: "note-1", basedOnRev: 1, generation: "generation-A", title: "Title", folderId: null, tags: [], why: "Reason" },
  new: { generation: "generation-A", title: "Title", folderId: null, tags: [], why: "Reason" },
  trash: { note: "note-1", basedOnRev: 1, generation: "generation-A", trash: true, why: "Reason" },
};
const snapshot = { meta: { generation: "generation-A" }, folders: [{ id: "folder", name: "Folder" }],
  notes: [note({ html: '<img data-file="own">' }), note({ id: "other", html: '<img data-file="other-image">' }),
    note({ id: "trashed", deletedAt: "2026-10-20T00:00:00.000Z", html: '<img data-file="trash-image">' })],
  files: { orphan: {} } };

it.each(Object.keys(details))("accepts the %s shape and rejects every missing or extra field", (kind) => {
  const value = details[kind];
  expect(proposalKind(value)).toBe(kind);
  expect(proposalProblem(value)).toBeNull();
  for (const key of Object.keys(value)) {
    const partial = { ...value }; delete partial[key];
    expect(proposalProblem(partial), key).toBe("invalid-shape");
  }
  for (const key of ["body", "proposal", "hash", "pinned", "deletedAt", "extra"]) {
    expect(proposalProblem({ ...value, [key]: true }), key).toBe("invalid-shape");
  }
});
it.each([null, [], 1, "value"])("rejects non-object details %j", (value) => {
  expect(proposalProblem(value)).toBe("invalid-shape");
});
it.each([false, null, 1, "true"])("classifies a present trash key before checking its value %j", (trash) => {
  expect(proposalKind({ trash })).toBe("trash");
  expect(proposalProblem({ ...details.trash, trash })).toBe("invalid-shape");
});
it.each(["edit", "new"])("checks %s new-folder names and requires folderId null", (kind) => {
  for (const newFolder of ["Recipes", "á".repeat(512)]) {
    expect(proposalProblem({ ...details[kind], newFolder })).toBeNull();
  }
  for (const newFolder of [null, 1, "", " ", " Folder", "Folder ", "\u0000", "\u007f", "x".repeat(513)]) {
    expect(proposalProblem({ ...details[kind], newFolder }), String(newFolder)).toBe("invalid-folder");
  }
  for (const folderId of ["folder", "absent", "", 0]) {
    expect(proposalProblem({ ...details[kind], folderId, newFolder: "Recipes" })).toBe("invalid-folder");
  }
});
it.each(["title", "folderId", "tags", "newFolder"])("refuses %s on Trash as an extra field", (key) => {
  expect(proposalProblem({ ...details.trash, [key]: details.edit[key] ?? "Folder" })).toBe("invalid-shape");
});
it.each([
  ["edit", { note: "" }, "invalid-note"], ["trash", { note: "" }, "invalid-note"],
  ["edit", { basedOnRev: 0 }, "invalid-rev"], ["trash", { basedOnRev: "1" }, "invalid-rev"],
  ...["edit", "new", "trash"].flatMap((kind) => [
    [kind, { generation: 2 }, "invalid-generation"], [kind, { why: "x".repeat(301) }, "invalid-why"],
  ]),
  ...["edit", "new"].flatMap((kind) => [
    [kind, { title: "\u0085" }, "invalid-title"], [kind, { title: "x".repeat(201) }, "invalid-title"],
    [kind, { title: null }, "invalid-title"], [kind, { folderId: 0 }, "invalid-folder"],
    [kind, { folderId: " " }, "invalid-folder"], [kind, { tags: ["x", "x"] }, "invalid-tags"],
    [kind, { tags: [" x"] }, "invalid-tags"], [kind, { tags: null }, "invalid-tags"],
    [kind, { tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`) }, "invalid-tags"],
  ]),
])("checks %s field values %j (%s)", (kind, extra, reason) => {
  expect(proposalProblem({ ...details[kind], ...extra })).toBe(reason);
});
it("preserves edit shape-check precedence", () => {
  const value = { ...details.edit, note: "", basedOnRev: 0, generation: 1, title: null,
    folderId: 0, tags: null, why: null };
  for (const [key, reason] of [["note", "invalid-note"], ["basedOnRev", "invalid-rev"], ["generation", "invalid-generation"],
    ["title", "invalid-title"], ["folderId", "invalid-folder"], ["tags", "invalid-tags"], ["why", "invalid-why"]]) {
    expect(proposalProblem(value)).toBe(reason);
    value[key] = details.edit[key];
  }
  expect(proposalProblem(value)).toBeNull();
});
it.each([
  ...["edit", "trash"].flatMap((kind) => [
    [kind, { note: "absent" }, "unknown-note"], [kind, { note: "trashed" }, "note-in-trash"],
    [kind, { basedOnRev: 2 }, "changed-since-read"],
  ]),
  ...["edit", "new", "trash"].map((kind) => [kind, { generation: "old" }, "changed-since-read"]),
  ...["edit", "new"].flatMap((kind) => [
    [kind, { folderId: "absent" }, "unknown-folder"], [kind, { newFolder: "fOlDeR" }, "folder-exists"],
    [kind, { body: '<a href="note:absent">Missing</a>' }, "unknown-note-link"],
    [kind, { body: '<a href="note:trashed">Trash</a>' }, "unknown-note-link"],
    [kind, { body: '<img data-file="orphan">' }, "new-image"],
    [kind, { body: '<img data-file="trash-image">' }, "new-image"],
  ]),
  ["edit", { body: '<img data-file="other-image">' }, "new-image"],
])("checks %s references %j (%s)", (kind, extra, reason) => {
  expect(referenceProblem({ ...details[kind], body: "", ...extra }, snapshot)).toBe(reason);
});
it.each(["edit", "new", "trash"])("accepts current %s references", (kind) => {
  expect(referenceProblem({ ...details[kind], body: '<img data-file="own"><a href="note:other">Other</a>' }, snapshot)).toBeNull();
});
it("allows a new note to reuse pictures from any live note's HTML, independent of file bindings", () => {
  expect(referenceProblem({ ...details.new, body: '<img data-file="other-image">' }, snapshot)).toBeNull();
});
it("reports reference problems in notebook, folder, link, picture, pid order", () => {
  const value = { ...details.new, proposal: "p-fixture", generation: "old", folderId: "missing", newFolder: "Folder",
    body: '<a href="note:absent">Link</a><img data-file="new">' };
  const records = [{ record: { ...details.new, proposal: value.proposal, status: "kept" } }];
  expect(referenceProblem(value, snapshot, records)).toBe("changed-since-read");
  value.generation = snapshot.meta.generation;
  expect(referenceProblem(value, snapshot, records)).toBe("unknown-folder");
  value.folderId = null;
  expect(referenceProblem(value, snapshot, records)).toBe("folder-exists");
  value.newFolder = "Recipes";
  expect(referenceProblem(value, snapshot, records)).toBe("unknown-note-link");
  value.body = '<img data-file="new">';
  expect(referenceProblem(value, snapshot, records)).toBe("new-image");
  value.body = "";
  expect(referenceProblem(value, snapshot, records)).toBe("pid-used");
});
