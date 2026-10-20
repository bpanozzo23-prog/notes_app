import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { diffNoteBodies } from "../../claude/diff.js";
import { classBefore, classProposal } from "../../claude/fixtures/tidy.js";
import ReviewRow from "./ReviewRow.jsx";
import InlineDiff from "./InlineDiff.jsx";
import ChangeRow from "./ChangeRow.jsx";
import TitleRow from "./TitleRow.jsx";
import TagsRow from "./TagsRow.jsx";
import FolderRow from "./FolderRow.jsx";
import ReviewActionBar from "./ReviewActionBar.jsx";
import StaleBanner from "./StaleBanner.jsx";
import NoteReviewCard from "./NoteReviewCard.jsx";

afterEach(cleanup);
const rowProps = () => ({ checked: true, onToggle: vi.fn() });
const changeBetween = (before, after) => diffNoteBodies(before, after).find((run) => run.id);
const button = (name) => screen.getByRole("button", { name, exact: true });

it("renders semantic additions/removals, hidden spoken prefixes and literal text with all whitespace intact", () => {
  const words = [{ value: "  Start\t\n\n" }, { value: "old  words\n", removed: true }, { value: "new\twords\n\n", added: true }, { value: "<script>literal</script>  end" }];
  const { container } = render(<InlineDiff words={words} />);
  expect(container.querySelector("del").textContent).toBe("removed: old  words\n");
  expect(container.querySelector("ins").textContent).toBe("added: new\twords\n\n");
  expect(screen.getByText("removed:").classList.contains("sr-only")).toBe(true);
  expect(screen.getByText("added:").classList.contains("sr-only")).toBe(true);
  const visible = container.firstChild.cloneNode(true);
  visible.querySelectorAll(".sr-only").forEach((node) => node.remove());
  expect(visible.textContent).toBe(words.map((part) => part.value).join(""));
  expect(visible.classList.contains("whitespace-pre-wrap")).toBe(true);
  expect(container.querySelector("script")).toBeNull();
});

it("the real checkbox works with the keyboard and its label target, announces the reason and respects disabled", async () => {
  const user = userEvent.setup(), onToggle = vi.fn();
  function Row({ disabled }) {
    const [checked, setChecked] = useState(true);
    return <ReviewRow label="Text · 1 word" checked={checked} onToggle={() => { setChecked(!checked); onToggle(); }} reason="Fix an accent." disabled={disabled}>Content</ReviewRow>;
  }
  const view = render(<Row />);
  const checkbox = screen.getByRole("checkbox", { name: "Text · 1 word" });
  expect(checkbox.tagName).toBe("INPUT"); expect(checkbox.type).toBe("checkbox");
  expect(document.getElementById(checkbox.getAttribute("aria-describedby")).textContent).toBe("Fix an accent.");
  await user.tab(); expect(document.activeElement).toBe(checkbox);
  await user.keyboard(" "); expect(checkbox.checked).toBe(false);
  await user.click(checkbox.closest("label")); expect(checkbox.checked).toBe(true);
  view.rerender(<Row disabled />);
  await user.click(checkbox.closest("label")); expect(onToggle).toHaveBeenCalledTimes(2);
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.closest(".review-row").classList.contains("opacity-55")).toBe(true);
});

it("text changes show a compact word count and toggle the original formatted Before/After without changing the tick", () => {
  const change = changeBetween(classBefore, classProposal.html), props = rowProps();
  const { container } = render(<ChangeRow change={change} {...props} />);
  expect(screen.getByText("Text · 4 words")).toBeTruthy();
  expect(screen.queryByText(/Change \d/)).toBeNull();
  expect(container.querySelectorAll("del")).toHaveLength(4);
  expect(container.querySelectorAll("ins")).toHaveLength(4);
  expect(container.querySelector(".ProseMirror")).toBeNull();
  expect(button("Show before and after").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button("Show before and after"));
  expect(button("Hide before and after").getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelectorAll(".ProseMirror")).toHaveLength(2);
  expect(screen.getByText("− Before").parentElement.textContent).toContain("ojala que tu vengas");
  expect(screen.getByText("+ After").parentElement.textContent).toContain("Ojalá que tú vengas");
  expect(container.querySelector(".ProseMirror").getAttribute("contenteditable")).toBe("false");
  fireEvent.click(button("Hide before and after"));
  expect(container.querySelector(".ProseMirror")).toBeNull();
  expect(props.onToggle).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox").checked).toBe(true);
});

it("counts disjoint insertions and removals as well as replacements", () => {
  render(<ChangeRow change={changeBetween("<p>Remove this. Keep. Change me.</p>", "<p>Keep. Replace me. Add words.</p>")} {...rowProps()} />);
  expect(screen.getByText("Text · 5 words")).toBeTruthy();
});

it("formatting-only changes show the formatted After and chips, with formatted Before on demand", () => {
  const { container } = render(<ChangeRow change={changeBetween("<p>Hello</p>", "<p><strong>Hello</strong></p>")} {...rowProps()} />);
  expect(screen.getByText("Text")).toBeTruthy(); expect(screen.getByText("bold added")).toBeTruthy();
  expect(container.querySelector(".ProseMirror strong").textContent).toBe("Hello");
  expect(container.querySelector("ins")).toBeNull();
  fireEvent.click(button("Show before and after"));
  expect(screen.getByText("− Before").parentElement.querySelector("strong")).toBeNull();
  expect(screen.getByText("+ After").parentElement.querySelector("strong").textContent).toBe("Hello");
});

it("word changes with formatting use the inline diff, chips and the formatted toggle", () => {
  const { container } = render(<ChangeRow change={changeBetween("<p>hello</p>", "<p><strong>Hello</strong></p>")} {...rowProps()} />);
  expect(screen.getByText("Text · 1 word")).toBeTruthy(); expect(screen.getByText("bold added")).toBeTruthy();
  expect(container.querySelector("del").textContent).toBe("removed: hello");
  expect(container.querySelector("ins").textContent).toBe("added: Hello");
  expect(container.querySelector(".ProseMirror")).toBeNull();
  fireEvent.click(button("Show before and after"));
  expect(screen.getByText("+ After").parentElement.querySelector("strong").textContent).toBe("Hello");
});

it.each([
  ["<p>One and two</p>", "<ul><li><p>One</p></li><li><p>Two</p></li></ul>", "now a bulleted list", "ul"],
  ["<p>Heading</p>", "<h2>Heading</h2>", "now a heading", "h2"],
])("shape changes show their formatted result and a plain Before line (%s)", (before, after, chip, tag) => {
  const { container } = render(<ChangeRow change={changeBetween(before, after)} {...rowProps()} />);
  expect(screen.getByText(chip)).toBeTruthy();
  expect(container.querySelector(`.ProseMirror ${tag}`)).toBeTruthy();
  expect(screen.getByText(/^Before:/).querySelector("*")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(container.querySelector("del")).toBeNull();
});

it("also recognises the new-heading label", () => {
  const change = { ...changeBetween("<p>Heading</p>", "<h2>Heading</h2>"), formatting: ["new heading"] };
  render(<ChangeRow change={change} {...rowProps()} />);
  expect(screen.getByText("new heading")).toBeTruthy(); expect(screen.getByText("Before: Heading")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it.each([
  ["Added", "<p>Stay</p>", "<p>Stay</p><p><strong>Added text</strong></p>", "Added text", "--color-ins-ink"],
  ["Removed", "<p><em>Removed text</em></p><p>Stay</p>", "<p>Stay</p>", "Removed text", "--color-del-ink"],
])("%s blocks show only their formatted content and coloured edge", (label, before, after, content, colour) => {
  const { container } = render(<ChangeRow change={changeBetween(before, after)} {...rowProps()} />);
  expect(screen.getByText(label)).toBeTruthy();
  const preview = container.querySelector(".claude-preview");
  expect(preview.textContent).toBe(content);
  expect(preview.parentElement.className).toContain(colour);
  expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1);
  expect(screen.queryByRole("button")).toBeNull();
});

it("keeps all image and link effect wording with decorative icons and full destinations", () => {
  const change = { ...changeBetween("<p>Same</p>", "<p><strong>Same</strong></p>"), effects: [
    { type: "image-removed" }, { type: "image-added" },
    { type: "link-retargeted", before: "note:a", after: "note:b" },
    { type: "link-removed", href: "note:missing" }, { type: "note-link-added", href: "note:a" },
    { type: "web-link-added", href: "https://example.com/full/path" },
  ] };
  render(<ChangeRow change={change} {...rowProps()} titles={new Map([["a", "Alpha"], ["b", "Beta"]])} />);
  for (const label of ["Removes an image", "Adds an image", "Link now points to Beta (was Alpha)", "Removes a link to Missing or trashed note", "Adds a note link: Alpha", "Adds a web link: https://example.com/full/path"]) {
    expect(screen.getByText(label).parentElement.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
  }
  expect(screen.queryByRole("link")).toBeNull();
});

it("TitleRow shows the proposal first and reveals the existing controlled title input and errors via Edit", () => {
  function Title() {
    const [title, setTitle] = useState("New title");
    return <TitleRow {...rowProps()} before="Old title" title={title} onEdit={setTitle} error={title.length > 200 ? "Title must be 200 characters or fewer." : ""} reason="Clearer." />;
  }
  const { container } = render(<Title />);
  expect(container.querySelector("ins").textContent).toBe("added: New title");
  expect(screen.getByText("was: Old title")).toBeTruthy(); expect(screen.getByText("Clearer.")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(button("Edit")); const input = screen.getByRole("textbox", { name: "Proposed title" });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "x".repeat(201) } });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(input.getAttribute("aria-describedby"))).toBe(screen.getByRole("alert"));
  fireEvent.change(input, { target: { value: "My title" } });
  expect(container.querySelector("ins").textContent).toBe("added: My title");
  fireEvent.click(button("Edit")); expect(screen.queryByRole("textbox")).toBeNull();
  expect(container.querySelector("ins").textContent).toBe("added: My title");
});

it("tag chips show only added and removed tags and keep the original checkbox name", () => {
  const { container } = render(<TagsRow {...rowProps()} added={["clase", "nuevo"]} removed={["spanish"]} reason="Easier to find." />);
  expect(screen.getByRole("checkbox", { name: "Tags: + clase + nuevo − spanish" }).checked).toBe(true);
  expect(screen.getByText("+ clase").className).toContain("--color-ins-bg");
  expect(screen.getByText("+ nuevo")).toBeTruthy();
  expect(container.querySelector("del").textContent).toBe("removed: spanish");
  expect(container.querySelector("del").className).toContain("--color-del-bg");
  expect(screen.getByText("Easier to find.")).toBeTruthy();
});

it("folder rows name the old and new folders and identify a newly created folder", () => {
  render(<FolderRow {...rowProps()} before="No folder" after="Clases" isNew reason="Group the class notes." />);
  expect(screen.getByRole("checkbox", { name: "Folder: No folder → Clases (new folder)" })).toBeTruthy();
  expect(screen.getByText("Clases (new folder)")).toBeTruthy(); expect(screen.getByText("Group the class notes.")).toBeTruthy();
});

it("the action bar runs the supplied Apply/Discard handlers, respects disabled and allows no secondary", () => {
  const primary = { label: "Apply 3 changes", onClick: vi.fn() }, secondary = { label: "Discard", onClick: vi.fn() };
  const view = render(<ReviewActionBar primary={primary} secondary={secondary} />);
  const actions = within(screen.getByRole("group", { name: "Review actions" }));
  fireEvent.click(actions.getByRole("button", { name: "Apply 3 changes" })); fireEvent.click(actions.getByRole("button", { name: "Discard" }));
  expect(primary.onClick).toHaveBeenCalledTimes(1); expect(secondary.onClick).toHaveBeenCalledTimes(1);
  view.rerender(<ReviewActionBar primary={{ ...primary, disabled: true }} secondary={{ ...secondary, disabled: true }} />);
  fireEvent.click(button("Apply 3 changes")); fireEvent.click(button("Discard"));
  expect(primary.onClick).toHaveBeenCalledTimes(1); expect(secondary.onClick).toHaveBeenCalledTimes(1);
  view.rerender(<ReviewActionBar primary={primary} />);
  expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  view.rerender(<ReviewActionBar secondary={secondary} />);
  expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
});

it("the stale banner announces its message and supports an optional Ask again action", () => {
  const action = { label: "Ask again", onClick: vi.fn() };
  const view = render(<StaleBanner message="This note changed since Claude read it." action={action} />);
  expect(screen.getByRole("alert").textContent).toContain("This note changed since Claude read it.");
  fireEvent.click(button("Ask again")); expect(action.onClick).toHaveBeenCalledTimes(1);
  view.rerender(<StaleBanner message="Kept on the XPS." />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("note cards support a quoted reason, rows and a red Dismiss action for the XPS review", () => {
  const onClick = vi.fn();
  render(<NoteReviewCard title="Class notes" reason="Fixed two accents." action={{ label: "Dismiss", onClick }}>
    <ReviewRow {...rowProps()} label="Text">A change.</ReviewRow>
  </NoteReviewCard>);
  const card = within(screen.getByRole("article", { name: "Class notes" }));
  expect(card.getByRole("heading", { name: "Class notes" })).toBeTruthy();
  expect(card.getByText("“Fixed two accents.”")).toBeTruthy();
  expect(card.getByRole("checkbox", { name: "Text" })).toBeTruthy();
  expect(button("Dismiss").className).toContain("--color-danger");
  fireEvent.click(button("Dismiss")); expect(onClick).toHaveBeenCalledTimes(1);
});

it("doesn't repeat Ask again when the banner's button says it", () => {
  render(<StaleBanner message="This note changed since Claude read it. Ask again." action={{ label: "Ask again", onClick: () => {} }} />);
  expect(screen.getByRole("alert").querySelector("p").textContent).toBe("This note changed since Claude read it.");
  expect(screen.getByRole("button", { name: "Ask again" })).toBeTruthy();
});

it("tolerates a banner without a text message", () => {
  render(<StaleBanner message={undefined} action={{ label: "Ask again", onClick: () => {} }} />);
  expect(screen.getByRole("button", { name: "Ask again" })).toBeTruthy();
});
