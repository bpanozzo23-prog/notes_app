import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateBackup, buildBackup, importBackup } from "./backup.js";
import { extractFileIds, extractNoteLinks, htmlToText } from "../lib/text.js";

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
  expect(result.envelope.schemaVersion).toBe(5);
  for (const note of result.envelope.notes) for (const id of extractFileIds(note.html)) {
    const image = result.envelope.files.find((file) => file.id === id);
    expect(image).toBeDefined();
    expect(Buffer.from(image.data, "base64").length).toBe(image.size);
  }
  const ids = new Set(result.envelope.notes.map((note) => note.id));
  for (const note of result.envelope.notes) for (const target of note.linkedIds) expect(ids.has(target)).toBe(true);
});


import { Editor } from "@tiptap/core";
import { extensions } from "../editor/extensions.js";
import { db } from "./db.js";
import { updateNote } from "./notes.js";
import { resetDatabase } from "../test/fixtures.js";
const editors = [];
const open = (html) => { const editor = new Editor({ extensions, content: html }); editors.push(editor); return editor; };
beforeEach(resetDatabase);
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

it("preserves every formatting-note value through editor, save, reopen, backup, import and editor", async () => {
  const sample = JSON.parse(file);
  await importBackup(sample);
  const note = sample.notes.find((note) => note.title === "Muestra de formato");
  const original = open(note.html).getHTML();
  await updateNote(note.id, { html: original });
  const reopened = open((await db.notes.get(note.id)).html);
  expect(reopened.getHTML()).toBe(original);
  const backup = await buildBackup();
  expect(backup.schemaVersion).toBe(5);
  expect(backup.preferences.namedStyles).toEqual(sample.preferences.namedStyles);
  await db.notes.clear();
  await importBackup(backup);
  expect((await buildBackup()).preferences.namedStyles).toEqual(sample.preferences.namedStyles);
  const restored = open((await db.notes.get(note.id)).html).getHTML();
  expect(restored).toBe(original);
  const body = document.createElement("div"); body.innerHTML = restored;
  expect([...body.querySelectorAll("mark")].map((node) => node.dataset.color ?? null)).toEqual(["#fde68a", "#bfdbfe", "#a7f3d0", null]);
  expect([...body.querySelectorAll("span[style]")].map((node) => node.style.fontSize || node.style.fontFamily)).toEqual(["12pt", "17pt", "24pt", "serif", "monospace", "17pt"]);
  expect([...body.querySelectorAll('li[data-collapsed="true"]')].map((node) => node.querySelector("p").textContent)).toEqual(["Lista plegada", "Paso plegado", "Tarea plegada"]);
  expect(body.querySelector('p[style]').style.lineHeight).toBe("1.5");
  expect([...body.querySelectorAll('[data-callout]')].map((node) => node.dataset.callout)).toEqual(["note", "tip", "warning", "important"]);
  expect([...body.querySelectorAll('hr')].map((node) => node.dataset.style ?? "thin")).toEqual(["thin", "thick", "dashed", "dotted"]);
  expect(htmlToText(restored)).not.toMatch(/ℹ|💡|⚠|❗/);
});

it("keeps image dimensions, reference and identical bytes through editor/save/restore", async () => {
  const sample = JSON.parse(file); await importBackup(sample);
  const note = sample.notes.find((note) => note.title === "Captura de ejemplo");
  const before = sample.files[0];
  const html = open(note.html).getHTML();
  expect(html).not.toMatch(/src=|blob:/);
  await updateNote(note.id, { html });
  const backup = await buildBackup(); await importBackup(backup);
  const restored = open((await db.notes.get(note.id)).html).getHTML();
  const element = document.createElement("div"); element.innerHTML = restored;
  expect(element.querySelector("img").getAttribute("data-file")).toBe(before.id);
  expect(element.querySelector("img").getAttribute("width")).toBe("480");
  expect(element.querySelector("img").getAttribute("height")).toBe("270");
  expect(Buffer.from((await db.fileData.get(before.id)).bytes).equals(Buffer.from(before.data, "base64"))).toBe(true);
});
