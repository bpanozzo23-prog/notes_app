import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NotesList from "./NotesList.jsx";
import { noteFixture } from "../test/fixtures.js";

afterEach(cleanup);
it("filters folders/tags, orders pinned first then recent, and sorts live tag chips by frequency/name", () => {
  const notes = [
    noteFixture({ id: "new", title: "Newest", updatedAt: "2026-10-17", tags: ["zebra", "apple"], folderId: "f" }),
    noteFixture({ id: "old", title: "Older", updatedAt: "2026-10-15", tags: ["apple", "banana"] }),
    noteFixture({ id: "pin", title: "Pinned older", pinned: true, updatedAt: "2026-10-14", tags: ["zebra"], folderId: "f" }),
  ];
  function Harness() {
    const [filter, setFilter] = useState({ type: "all" });
    return <NotesList notes={notes} folders={[{ id: "f", name: "Reading" }]} filter={filter} onFilter={setFilter} onOpen={() => {}} onNew={() => {}} trashCount={2} />;
  }
  render(<Harness />);
  const titles = () => within(screen.getByRole("list", { name: "Notes" })).queryAllByRole("button").map((button) => button.getAttribute("aria-label"));
  expect(titles()).toEqual(["Pinned older", "Newest", "Older"]);
  expect(within(screen.getByRole("group", { name: "Filter notes" })).getAllByRole("button").map((button) => button.textContent)).toEqual(["All", "Reading", "#apple", "#zebra", "#banana"]);
  fireEvent.click(screen.getByRole("button", { name: "Reading" }));
  expect(titles()).toEqual(["Pinned older", "Newest"]);
  fireEvent.click(screen.getByRole("button", { name: "#banana" }));
  expect(titles()).toEqual(["Older"]);
  fireEvent.click(screen.getByRole("button", { name: "All", exact: true }));
  expect(titles()).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Trash (2)" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Search notes" }).disabled).toBe(false);
  expect(screen.getByRole("textbox", { name: "Search notes" }).title).toBe("");
});

it("combines all search words with chips, keeps spaces while typing, clears, and closes the keyboard on Enter", () => {
  const notes = [
    noteFixture({ id: "a", title: "ÁRBOL", text: "Un niño lee", folderId: "f", tags: ["Spanish"] }),
    noteFixture({ id: "b", title: "Otro árbol", text: "Niño", tags: ["Spanish"] }),
    noteFixture({ id: "c", title: "Árbol solo", text: "No match", folderId: "f" }),
  ];
  function Harness() {
    const [filter, setFilter] = useState({ type: "all" });
    const [query, setQuery] = useState("");
    return <NotesList notes={notes} folders={[{ id: "f", name: "Reading" }]} filter={filter} onFilter={setFilter}
      query={query} onQuery={(value) => setQuery(value.trim())} />;
  }
  render(<Harness />);
  const titles = () => within(screen.getByRole("list", { name: "Notes" })).queryAllByRole("button").map((button) => button.getAttribute("aria-label"));
  const input = screen.getByRole("textbox", { name: "Search notes" });
  fireEvent.change(input, { target: { value: "arbol" } });
  fireEvent.change(input, { target: { value: "arbol " } });
  expect(input.value).toBe("arbol ");
  fireEvent.change(input, { target: { value: "arbol NINO" } });
  expect(titles()).toEqual(["ÁRBOL", "Otro árbol"]);
  fireEvent.click(screen.getByRole("button", { name: "Reading" }));
  expect(titles()).toEqual(["ÁRBOL"]);
  fireEvent.click(screen.getByRole("button", { name: "#Spanish" }));
  expect(titles()).toEqual(["ÁRBOL", "Otro árbol"]);
  fireEvent.change(input, { target: { value: "missing" } });
  expect(screen.getByText("No notes match.")).toBeTruthy();
  input.focus();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(document.activeElement).not.toBe(input);
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(input.value).toBe("");
  expect(titles()).toEqual(["ÁRBOL", "Otro árbol"]); // Tag chip is still applied.
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
});
it("shows first-line and untitled fallbacks, and opens the selected note", () => {
  const open = vi.fn();
  render(<NotesList notes={[noteFixture({ title: "", text: "\nFirst line\nSecond line" }), noteFixture({ id: "empty", title: "", text: "" })]}
    folders={[]} filter={{ type: "all" }} onOpen={open} />);
  fireEvent.click(screen.getByRole("button", { name: "First line" }));
  expect(open).toHaveBeenCalledWith({ screen: "note", noteId: noteFixture().id });
  expect(screen.getByRole("button", { name: "Untitled note" })).toBeTruthy();
});

it("shows each note's last edit date beside its folder", () => {
  const edited = new Date(2025, 2, 9, 10, 0).toISOString();
  render(<NotesList notes={[noteFixture({ id: "dated", title: "Dated", updatedAt: edited, folderId: "f" })]} folders={[{ id: "f", name: "Reading" }]}
    filter={{ type: "all" }} onFilter={() => {}} onOpen={() => {}} onNew={() => {}} trashCount={0} />);
  expect(within(screen.getByRole("button", { name: "Dated" })).getByText("Reading · 9 Mar 2025")).toBeTruthy();
});

it("shows a matching snippet with bold words and passes find, keeping the row's title label", () => {
  const open = vi.fn(), note = noteFixture({ title: "Spanish", text: "Opening line\nUn niño toma café\nLast line" });
  const props = { notes: [note], folders: [], filter: { type: "all" }, onOpen: open };
  const view = render(<NotesList {...props} query="nino cafe" />);
  const row = screen.getByRole("button", { name: "Spanish", exact: true });
  expect([...row.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual(["niño", "café"]);
  expect(row.textContent).not.toContain("Opening line");
  fireEvent.click(row);
  expect(open).toHaveBeenCalledWith({ screen: "note", noteId: note.id, find: "nino cafe" });
  view.rerender(<NotesList {...props} query="Spanish" />);
  expect(row.querySelector("mark")).toBeNull();
  expect(row.textContent).toContain("Opening line");
  view.rerender(<NotesList {...props} />);
  expect(row.querySelector(".truncate.text-sm").textContent).toBe("Opening line Un niño toma café Last line");
});
