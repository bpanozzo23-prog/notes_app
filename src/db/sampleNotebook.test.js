import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { validateBackup } from "./backup.js";
import { extractNoteLinks, htmlToText } from "../lib/text.js";

// public/sample-notebook.json is what `npm run shots` imports and what the owner can import to
// try the app. It must keep validating as the schema evolves (regenerate it with the script).
const file = readFileSync(resolve(__dirname, "../../public/sample-notebook.json"), "utf8");

it("the sample notebook imports cleanly and its derived fields are current", () => {
  const result = validateBackup(file);
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  expect(result.summary.notes).toBeGreaterThan(5);
  expect(result.summary.trashed).toBe(1);
  for (const note of result.envelope.notes) {
    expect(note.text).toBe(htmlToText(note.html));
    expect(note.linkedIds).toEqual(extractNoteLinks(note.html));
  }
  const ids = new Set(result.envelope.notes.map((note) => note.id));
  for (const note of result.envelope.notes) for (const target of note.linkedIds) expect(ids.has(target)).toBe(true);
});
