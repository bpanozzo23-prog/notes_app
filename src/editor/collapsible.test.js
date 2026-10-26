import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { undo, redo } from "@tiptap/pm/history";
import { extensions } from "./extensions.js";
import { toggleCollapsed } from "./nodes/Collapsible.js";
import { resolveAction } from "./actions.js";

const editors = [];
function editorFor(content, options = {}) {
  const element = document.body.appendChild(document.createElement("div"));
  const editor = new Editor({ element, extensions, content, ...options });
  editors.push(editor);
  return editor;
}
afterEach(() => { editors.splice(0).forEach((editor) => { editor.view.dom.parentElement?.remove(); editor.destroy(); }); });

// The editor adds an empty last line after a list (StarterKit's trailing node).
const html = (editor) => editor.getHTML().replace(/<p><\/p>$/, "");
const textPos = (editor, text, offset = 0) => {
  let at = null;
  editor.state.doc.descendants((node, pos) => { if (at === null && node.isText && node.text.includes(text)) at = pos + node.text.indexOf(text) + offset; });
  if (at === null) throw new Error(`No text ${text}`);
  return at;
};
// Position of the innermost list item holding this text.
const itemPos = (editor, text) => {
  const $pos = editor.state.doc.resolve(textPos(editor, text));
  for (let depth = $pos.depth; depth > 0; depth--) if (["listItem", "taskItem"].includes($pos.node(depth).type.name)) return $pos.before(depth);
  throw new Error(`No item for ${text}`);
};
const put = (editor, text, offset = 0) => editor.commands.setTextSelection(textPos(editor, text, offset));
const toggle = (editor, text) => toggleCollapsed(editor.view, itemPos(editor, text));
const collapsed = (editor, text) => editor.state.doc.nodeAt(itemPos(editor, text)).attrs.collapsed;
const enter = (editor) => editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, new KeyboardEvent("keydown", { key: "Enter" })));

const BULLETS = "<ul><li><p>Parent</p><ul><li><p>Child one</p></li><li><p>Child two</p></li></ul></li><li><p>Next</p></li></ul>";
const NUMBERED = "<ol><li><p>Parent</p><ol><li><p>Child one</p></li></ol></li><li><p>Next</p></li></ol>";
const task = (text, checked, inner = "") => `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? ' checked="checked"' : ""}><span></span></label><div><p>${text}</p>${inner}</div></li>`;
const TASKS = `<ul data-type="taskList">${task("Parent", true, `<ul data-type="taskList">${task("Child one", false)}</ul>`)}${task("Next", false)}</ul>`;

describe("saving", () => {
  it("saves data-collapsed only when collapsed, so other notes are unchanged", () => {
    const editor = editorFor(BULLETS);
    expect(html(editor)).toBe(BULLETS);
    toggle(editor, "Parent");
    expect(html(editor)).toBe(BULLETS.replace("<ul><li><p>Parent", '<ul><li data-collapsed="true"><p>Parent'));
    const reopened = editorFor(editor.getHTML());
    expect(collapsed(reopened, "Parent")).toBe(true);
  });

  it("opens a note with collapsed or stale marks without changing it", () => {
    const stale = '<ul><li data-collapsed="true"><p>Alone</p></li></ul>';
    for (const content of [BULLETS.replace("<li><p>Parent", '<li data-collapsed="true"><p>Parent'), stale, `${stale}<p>After</p>`]) {
      const onUpdate = vi.fn();
      const editor = editorFor(content, { onUpdate });
      expect(onUpdate).not.toHaveBeenCalled();
      expect(html(editor)).toBe(content);
    }
  });

  it("puts the mark on a checklist line's li when created and when toggled, keeping its tick", () => {
    const editor = editorFor(TASKS);
    toggle(editor, "Parent");
    const li = editor.view.dom.querySelector('ul[data-type="taskList"] > li');
    expect(li.getAttribute("data-collapsed")).toBe("true");
    expect(li.getAttribute("data-checked")).toBe("true");
    expect(editorFor(editor.getHTML()).view.dom.querySelector('ul[data-type="taskList"] > li').getAttribute("data-collapsed")).toBe("true");
    toggle(editor, "Parent");
    expect(li.hasAttribute("data-collapsed")).toBe(false);
    expect(li.getAttribute("data-checked")).toBe("true");
  });
});

describe("the toggle", () => {
  it("shows only on lines with lines under them, and none when not editable", () => {
    const editor = editorFor(BULLETS);
    expect(editor.view.dom.querySelectorAll(".collapse-toggle")).toHaveLength(1);
    const tasks = editorFor(TASKS);
    expect(tasks.view.dom.querySelector('ul[data-type="taskList"] > li > div > .collapse-toggle')).not.toBeNull();
    const readOnly = editorFor(BULLETS, { editable: false });
    expect(readOnly.view.dom.querySelectorAll(".collapse-toggle")).toHaveLength(0);
  });

  it("collapses on tap without taking focus, keeps the same li, and is not an undo step", () => {
    const editor = editorFor(`<p>Before</p>${BULLETS}`);
    put(editor, "Before");
    editor.commands.insertContent("typed ");
    const button = editor.view.dom.querySelector(".collapse-toggle");
    const li = button.parentElement;
    expect(fireEvent.pointerDown(button)).toBe(false);
    expect(fireEvent.mouseDown(button)).toBe(false);
    // Cancelling the touch would also cancel the tap's click on Android (owner's phone, 2026-10-22).
    expect(fireEvent.touchStart(button)).toBe(true);
    fireEvent.click(button);
    expect(collapsed(editor, "Parent")).toBe(true);
    expect(editor.view.dom.querySelector(".collapse-toggle").parentElement).toBe(li);
    expect(document.activeElement).not.toBe(editor.view.dom);
    undo(editor.state, editor.view.dispatch);
    expect(html(editor)).not.toContain("typed");
    expect(collapsed(editor, "Parent")).toBe(true);
    fireEvent.click(editor.view.dom.querySelector(".collapse-toggle"));
    expect(collapsed(editor, "Parent")).toBe(false);
  });

  it("moves the cursor out of lines it hides", () => {
    const editor = editorFor(BULLETS);
    put(editor, "Child two", 3);
    toggle(editor, "Parent");
    expect(collapsed(editor, "Parent")).toBe(true);
    expect(editor.state.selection.from).toBe(textPos(editor, "Parent", "Parent".length));
  });

  it("does nothing on a read-only note", () => {
    const editor = editorFor(BULLETS);
    const button = editor.view.dom.querySelector(".collapse-toggle");
    editor.setEditable(false);
    fireEvent.click(button);
    expect(collapsed(editor, "Parent")).toBe(false);
  });
});

describe("Enter on a collapsed line", () => {
  it.each([["bullets", BULLETS], ["numbered", NUMBERED], ["checklist", TASKS]])("starts a new line after the hidden group (%s)", (_kind, content) => {
    const editor = editorFor(content);
    toggle(editor, "Parent");
    put(editor, "Parent", "Parent".length);
    expect(enter(editor)).toBe(true);
    editor.commands.insertContent("New");
    const doc = editor.state.doc, list = doc.firstChild;
    expect(list.child(0).attrs.collapsed).toBe(true);
    expect(list.child(0).childCount).toBe(2);
    expect(list.child(1).textContent).toBe("New");
    expect(list.child(1).attrs.collapsed).toBe(false);
    if (list.child(1).type.name === "taskItem") expect(list.child(1).attrs.checked).toBe(false);
    expect(list.child(2).textContent).toBe("Next");
  });

  it("moves the rest of the line when pressed mid-line, as one undo step", () => {
    const editor = editorFor(BULLETS);
    toggle(editor, "Parent");
    put(editor, "Parent", 3);
    enter(editor);
    const list = editor.state.doc.firstChild;
    expect(list.child(0).firstChild.textContent).toBe("Par");
    expect(list.child(0).attrs.collapsed).toBe(true);
    expect(list.child(1).textContent).toBe("ent");
    undo(editor.state, editor.view.dispatch);
    expect(html(editor)).toBe(BULLETS.replace("<li><p>Parent", '<li data-collapsed="true"><p>Parent'));
  });

  it("keeps the default at the start of a line and on expanded lines", () => {
    const editor = editorFor(BULLETS);
    toggle(editor, "Parent");
    put(editor, "Parent");
    enter(editor);
    const list = editor.state.doc.firstChild;
    expect(list.child(0).textContent).toBe("");
    expect(list.child(1).attrs.collapsed).toBe(true);
    expect(list.child(1).firstChild.textContent).toBe("Parent");
    const open = editorFor(BULLETS);
    put(open, "Parent", "Parent".length);
    enter(open);
    expect(html(open)).not.toBe(BULLETS);
    expect(open.state.doc.firstChild.child(0).firstChild.textContent).toBe("Parent");
  });
});

describe("hidden lines never stay hidden around the cursor or a change", () => {
  it("expands when the cursor moves into hidden lines, as with Undo", () => {
    const editor = editorFor(BULLETS);
    toggle(editor, "Parent");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, textPos(editor, "Child one", 2))));
    expect(collapsed(editor, "Parent")).toBe(false);
  });

  it("expands when Indent moves a line into a collapsed one, and when Outdent takes the lines below", () => {
    const editor = editorFor(BULLETS);
    toggle(editor, "Parent");
    put(editor, "Next");
    resolveAction("indent").run({ editor });
    expect(collapsed(editor, "Parent")).toBe(false);
    expect(editor.state.doc.firstChild.childCount).toBe(1);

    const nested = editorFor("<ul><li><p>Top</p><ul><li><p>Mid</p><ul><li><p>Deep</p></li></ul></li><li><p>Sibling</p></li></ul></li></ul>");
    toggle(nested, "Mid");
    put(nested, "Mid");
    resolveAction("outdent").run({ editor: nested });
    expect(nested.getHTML()).toContain("Sibling");
    expect(collapsed(nested, "Mid")).toBe(false);
  });

  it("expands when Backspace after a list joins into a hidden last line", () => {
    const editor = editorFor(`${BULLETS.replace("<li><p>Next</p></li>", "")}<p>After</p>`);
    toggle(editor, "Parent");
    put(editor, "After");
    editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, new KeyboardEvent("keydown", { key: "Backspace" })));
    expect(collapsed(editor, "Parent")).toBe(false);
  });

  it("clears the mark when a line loses every line under it", () => {
    const editor = editorFor(BULLETS);
    toggle(editor, "Parent");
    const item = editor.state.doc.nodeAt(itemPos(editor, "Parent"));
    const pos = itemPos(editor, "Parent");
    editor.commands.deleteRange({ from: pos + 1 + item.firstChild.nodeSize, to: pos + item.nodeSize - 1 });
    expect(html(editor)).toBe("<ul><li><p>Parent</p></li><li><p>Next</p></li></ul>");
  });

  it("leaves typing in the first line alone, and redo works after undo", () => {
    const editor = editorFor(BULLETS);
    toggle(editor, "Parent");
    put(editor, "Parent", "Parent".length);
    editor.commands.insertContent("s");
    expect(collapsed(editor, "Parent")).toBe(true);
    undo(editor.state, editor.view.dispatch);
    expect(collapsed(editor, "Parent")).toBe(true);
    redo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.firstChild.child(0).firstChild.textContent).toBe("Parents");
  });
});

it.each([[BULLETS, 2], [NUMBERED, 1], [TASKS, 1]])("counts hidden leaf blocks only when folded: %s", (content, count) => {
  const editor = editorFor(content);
  const widget = () => editor.state.plugins.find((plugin) => plugin.key.startsWith("collapsible$")).getState(editor.state).find()[0];
  expect(editor.view.dom.querySelector(".collapse-toggle").hasAttribute("data-count")).toBe(false);
  expect(widget().spec.key).toBe("collapse-toggle");
  toggle(editor, "Parent");
  expect(editor.view.dom.querySelector(".collapse-toggle").dataset.count).toBe(String(count));
  expect(widget().spec.key).toBe(`collapse-toggle-${count}`);
  expect(editor.getHTML()).not.toContain("data-count");
  toggle(editor, "Parent");
  expect(editor.view.dom.querySelector(".collapse-toggle").hasAttribute("data-count")).toBe(false);
});
it("counts paragraphs and images in hidden children and redraws the widget when that count changes", () => {
  const editor = editorFor('<ul><li data-collapsed="true"><p>Parent</p><p>Second</p><img data-file="fixture"><ul><li><p>Nested</p><p>Extra</p></li></ul></li></ul><p></p>');
  const button = editor.view.dom.querySelector(".collapse-toggle");
  expect(button.dataset.count).toBe("4");
  const at = itemPos(editor, "Parent") + editor.state.doc.nodeAt(itemPos(editor, "Parent")).nodeSize - 1;
  editor.view.dispatch(editor.state.tr.insert(at, editor.schema.nodes.paragraph.create(null, editor.schema.text("Added"))).setMeta("fold", true).setMeta("skipTrailingNode", true));
  const next = editor.view.dom.querySelector(".collapse-toggle");
  expect(next).not.toBe(button); expect(next.dataset.count).toBe("5");
  expect(editor.getHTML()).not.toContain("data-count");
});
