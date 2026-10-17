import { expect, it } from "vitest";
import { searchNotes } from "./notebookView.js";
import { noteFixture } from "../test/fixtures.js";

it("searches every word across title and body, ignoring accents, case and word order", () => {
  const match = noteFixture({ title: "Árbol", text: "Un NIÑO\nleyó" });
  const other = noteFixture({ id: "other", title: "Árbol", text: "No child" });
  const notes = [match, other];
  expect(searchNotes(notes, "  leyo  ARBOL nino ")).toEqual([match]);
  expect(searchNotes(notes, "árbol")).toEqual(notes);
  expect(searchNotes(notes, "nino missing")).toEqual([]);
  expect(searchNotes(notes, "  ")).toBe(notes);
  expect(searchNotes(notes)).toBe(notes);
});
