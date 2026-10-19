import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import TagInput from "./TagInput.jsx";
import Dialog from "./Dialog.jsx";

afterEach(cleanup);

it("defaults to closed suggestions, supports the toggle, and hides suggestions after adding", () => {
  function Harness() {
    const [tags, setTags] = useState([]);
    return <TagInput tags={tags} allTags={["Spanish", "vocab"]} onChange={setTags} />;
  }
  render(<Harness />);
  expect(screen.getByRole("textbox", { name: "Add tag" }).hasAttribute("data-initial-focus")).toBe(false);
  const toggle = screen.getByRole("button", { name: "Used before (2)" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("group", { name: "Tag suggestions" })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("group", { name: "Tag suggestions" })).toBeTruthy();
  fireEvent.click(toggle);
  expect(screen.queryByRole("group", { name: "Tag suggestions" })).toBeNull();
  fireEvent.click(toggle);
  fireEvent.click(within(screen.getByRole("group", { name: "Tag suggestions" })).getByRole("button", { name: "Spanish" }));
  expect(screen.getByRole("button", { name: "Remove tag Spanish" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Tag suggestions" })).toBeNull();
  expect(screen.getByRole("button", { name: "Used before (1)" }).getAttribute("aria-expanded")).toBe("false");
});

it("lets Dialog focus Done when initial tag focus is disabled by a read-only fieldset", () => {
  render(<Dialog title="Tags" sheet onClose={() => {}}>
    <fieldset disabled><TagInput tags={["a"]} allTags={["b"]} onChange={() => {}} suggestionsOpen initialFocus /></fieldset>
    <button>Done</button>
  </Dialog>);
  expect(screen.getByRole("textbox", { name: "Add tag" }).matches(":disabled")).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
});
