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
  expect(screen.getByRole("textbox", { name: "Search notes" }).disabled).toBe(true);
  expect(screen.getByRole("textbox", { name: "Search notes" }).title).toBe("search arrives in 1c");
});
it("shows first-line and untitled fallbacks, and opens the selected note", () => {
  const open = vi.fn();
  render(<NotesList notes={[noteFixture({ title: "", text: "\nFirst line\nSecond line" }), noteFixture({ id: "empty", title: "", text: "" })]}
    folders={[]} filter={{ type: "all" }} onOpen={open} />);
  fireEvent.click(screen.getByRole("button", { name: "First line" }));
  expect(open).toHaveBeenCalledWith({ screen: "note", noteId: noteFixture().id });
  expect(screen.getByRole("button", { name: "Untitled note" })).toBeTruthy();
});
