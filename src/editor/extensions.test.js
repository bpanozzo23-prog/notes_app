import { afterEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { extensions, SUPPORTED_HTML_SAMPLES } from "./extensions.js";

const editors = [];
const editorFor = (content) => {
  const editor = new Editor({ extensions, content });
  editors.push(editor);
  return editor;
};
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); });
it.each(SUPPORTED_HTML_SAMPLES)("round-trips supported HTML idempotently: %s", (html) => {
  const first = editorFor(html).getHTML();
  const second = editorFor(first).getHTML();
  expect(second).toBe(first);
  // Idempotence alone would also pass if the parser dropped all formatting.
  const input = document.createElement("div");
  const output = document.createElement("div");
  input.innerHTML = html;
  output.innerHTML = first;
  expect(output.textContent).toBe(input.textContent);
  for (const node of input.querySelectorAll("*")) {
    expect(output.querySelector(node.tagName)).not.toBeNull();
    if (node.hasAttribute("style")) expect(output.querySelector(node.tagName).getAttribute("style")).toBeTruthy();
    if (node.hasAttribute("href")) expect(output.querySelector("a").getAttribute("href")).toBe(node.getAttribute("href"));
  }
});
it("drops unsupported tags and script content", () => {
  const html = editorFor('<marquee>Keep text</marquee><script>alert("bad")</script>').getHTML();
  expect(html).toContain("Keep text");
  expect(html).not.toMatch(/marquee|script|alert/);
});
it.each(["javascript:alert(1)", "data:text/html,bad", "http://example.com", "ftp://example.com", "/relative", "java&#x73;cript:alert(1)"])("drops forbidden link %s", (href) => {
  expect(editorFor(`<p><a href="${href}">Text</a></p>`).getHTML()).toBe("<p>Text</p>");
});
it("accepts note links through commands as well as HTML", () => {
  const editor = editorFor("<p>Link</p>");
  editor.commands.selectAll();
  expect(editor.commands.setLink({ href: "note:12345678-1234-4234-8234-123456789abc" })).toBe(true);
  expect(editor.getHTML()).toContain('href="note:12345678-1234-4234-8234-123456789abc"');
  expect(editor.commands.setLink({ href: "javascript:alert(1)" })).toBe(false);
});

it.each(SUPPORTED_HTML_SAMPLES)("preserves attribute values through two editors: %s", (html) => {
  const input = document.createElement("div"), output = document.createElement("div");
  input.innerHTML = html;
  output.innerHTML = editorFor(editorFor(html).getHTML()).getHTML();
  for (const tag of ["mark", "p", "h2", "span", "div[data-callout]", "hr"]) {
    const before = [...input.querySelectorAll(tag)], after = [...output.querySelectorAll(tag)];
    before.forEach((node, index) => {
      for (const attr of ["data-color", "data-callout", "data-style"]) {
        if (node.hasAttribute(attr)) expect(after[index].getAttribute(attr)).toBe(node.getAttribute(attr));
      }
      for (const prop of ["color", "backgroundColor", "lineHeight", "fontSize", "fontFamily"]) {
        if (node.style[prop]) expect(after[index].style[prop]).toBe(node.style[prop]);
      }
    });
  }
});

it("sanitises unknown values without changing plain Phase 1 marks or dividers", () => {
  expect(editorFor('<div data-callout="other"><p>Text</p></div>').getHTML()).toBe('<div data-callout="note"><p>Text</p></div>');
  expect(editorFor('<hr data-style="other">').getHTML()).toBe('<hr>');
  expect(editorFor('<p style="line-height: 3">Text</p><h2 style="line-height: 1.7">Title</h2>').getHTML()).toBe('<p>Text</p><h2>Title</h2>');
  expect(editorFor('<p><mark>Old</mark></p><hr>').getHTML()).toBe('<p><mark>Old</mark></p><hr>');
});

it("wraps, changes type, unwraps, merges whole touched callouts and undoes in one step", () => {
  const editor = editorFor('<p>one</p><p>two</p><p>three</p>');
  editor.commands.setTextSelection({ from: 2, to: 8 });
  const selected = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
  editor.commands.toggleCallout("tip");
  expect(editor.getHTML()).toBe('<div data-callout="tip"><p>one</p><p>two</p></div><p>three</p>');
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe(selected);
  editor.commands.toggleCallout("warning");
  expect(editor.getAttributes("callout").type).toBe("warning");
  editor.commands.toggleCallout("warning");
  expect(editor.getHTML()).toBe('<p>one</p><p>two</p><p>three</p>');
  editor.commands.setContent('<div data-callout="note"><p>one</p><p>two</p></div><p>three</p><div data-callout="tip"><p>four</p><p>five</p></div>');
  editor.commands.setTextSelection({ from: 8, to: 23 });
  editor.commands.toggleCallout("important");
  expect(editor.getHTML()).toBe('<div data-callout="important"><p>one</p><p>two</p><p>three</p><p>four</p><p>five</p></div>');
  editor.commands.unsetCallout();
  expect(editor.getHTML()).toBe('<p>one</p><p>two</p><p>three</p><p>four</p><p>five</p>');
});

function key(editor, name) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true });
  editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event));
}
it.each([
  ['<p>one</p><p></p>', 7, "Enter", '<div data-callout="tip"><p>one</p></div><p></p>'],
  ['<p>one</p><p></p><p>two</p>', 7, "Enter", '<div data-callout="tip"><p>one</p></div><p></p><div data-callout="tip"><p>two</p></div>'],
  ['<p>one</p><p>two</p>', 2, "Backspace", '<p>one</p><div data-callout="tip"><p>two</p></div>'],
])("callout keyboard behavior: %s %s %s", (html, cursor, name, expected) => {
  const editor = editorFor(`<div data-callout="tip">${html}</div>`);
  editor.commands.setTextSelection(cursor);
  key(editor, name);
  expect(editor.getHTML()).toBe(expected);
});

it.each([
  '<div data-callout="note"><p>before</p><div data-callout="tip"><p>inside</p></div><p>after</p></div>',
  '<ul><li><p>before</p><div data-callout="tip"><p>inside</p></div><p>after</p></li></ul>',
  '<blockquote><p>before</p><div data-callout="tip"><p>inside</p></div><p>after</p></blockquote>',
])("pastes nested callouts without losing any words: %s", (html) => {
  const editor = editorFor('<p></p>');
  editor.view.pasteHTML(html, new Event("paste"));
  expect(editor.getText().replace(/\s+/g, " ").trim()).toBe("before inside after");
  editor.state.doc.check();
  editor.state.doc.descendants((node, _pos, parent) => {
    if (node.type.name === "callout") expect(parent.type.name).toBe("doc");
  });
});

it("changes a selected divider instead of inserting another and keeps the thin input rule", () => {
  const editor = editorFor('<p>before</p><hr><p>after</p>');
  editor.commands.setNodeSelection(8);
  editor.commands.setDivider("dashed");
  expect(editor.getHTML()).toBe('<p>before</p><hr data-style="dashed"><p>after</p>');
  editor.commands.setDivider("thin");
  expect(editor.getHTML()).toBe('<p>before</p><hr><p>after</p>');
  editor.commands.setContent('<p>--</p>');
  editor.commands.setTextSelection(3);
  editor.view.someProp("handleTextInput", (handler) => handler(editor.view, 3, 3, "-"));
  expect(editor.state.doc.firstChild.type.name).toBe("horizontalRule");
  expect(editor.state.doc.firstChild.attrs.dividerStyle).toBe("thin");
});

it("sets whole touched lines, clears their inline spacing only, and Default clears both", () => {
  const editor = editorFor('<p><span style="line-height: 2; color: #dc2626">one</span></p><h2><span style="line-height: 2">two</span></h2><p><span style="line-height: 2">three</span></p>');
  editor.commands.setTextSelection({ from: 2, to: 8 });
  const selection = editor.state.selection.toJSON();
  editor.commands.setLineSpacing("1");
  expect(editor.state.doc.child(0).attrs.lineHeight).toBe("1");
  expect(editor.state.doc.child(1).attrs.lineHeight).toBe("1");
  expect(editor.state.doc.child(2).attrs.lineHeight).toBeNull();
  expect(editor.getHTML().match(/line-height: 2/g)).toHaveLength(1);
  expect(editor.state.doc.child(0).firstChild.marks[0].attrs.color).toBe("#dc2626");
  expect(editor.state.selection.toJSON()).toEqual(selection);
  editor.commands.unsetLineSpacing();
  expect(editor.getHTML().match(/line-height:/g)).toHaveLength(1);
  editor.commands.setTextSelection(12);
  editor.commands.unsetLineSpacing();
  expect(editor.getHTML()).not.toContain("line-height");
});

it.each(["toggleBulletList", "toggleOrderedList", "toggleTaskList", "toggleBlockquote"])("keeps callout content during %s and clearFormatting", (command) => {
  const editor = editorFor('<div data-callout="tip"><p>Hello</p></div>');
  editor.commands.setTextSelection(3);
  editor.commands[command]();
  editor.state.doc.check();
  expect(editor.getText().trim()).toBe("Hello");
  editor.chain().unsetAllMarks().clearNodes().run();
  expect(editor.getText().trim()).toBe("Hello");
  editor.state.doc.check();
});

it("keeps the first callout line separate when Backspace lifts it above a preceding paragraph", () => {
  const editor = editorFor('<p>before</p><div data-callout="tip"><p>one</p><p>two</p></div>');
  editor.commands.setTextSelection(10);
  key(editor, "Backspace");
  expect(editor.getHTML()).toBe('<p>before</p><p>one</p><div data-callout="tip"><p>two</p></div>');
});

it.each([1, 3, 6])("inserts a styled divider at paragraph position %s without losing adjacent words", (pos) => {
  const editor = editorFor('<p>Hello</p>');
  editor.commands.setTextSelection(pos);
  editor.commands.setDivider("dotted");
  editor.state.doc.check();
  expect(editor.state.doc.textContent).toBe("Hello");
  expect(editor.getHTML()).toContain('<hr data-style="dotted">');
  expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
});

it.each([
  ["##", " ", "heading"], ["-", " ", "bulletList"], ["[]", " ", "taskList"],
])("preserves the %s typing shortcut inside a callout", (before, typed, type) => {
  const editor = editorFor(`<div data-callout="tip"><p>${before}</p></div>`);
  const pos = 2 + before.length;
  editor.commands.setTextSelection(pos);
  editor.view.someProp("handleTextInput", (handler) => handler(editor.view, pos, pos, typed));
  expect(editor.state.doc.firstChild.type.name).toBe("callout");
  expect(editor.state.doc.firstChild.firstChild.type.name).toBe(type);
  editor.state.doc.check();
});

it("keeps heading and link insertion inside a callout and undoes a wrap in one step", () => {
  const editor = editorFor('<p>Hello</p>');
  editor.commands.setTextSelection(3);
  editor.commands.toggleCallout("tip");
  editor.commands.undo();
  expect(editor.getHTML()).toBe('<p>Hello</p>');
  editor.commands.redo();
  editor.commands.toggleHeading({ level: 2 });
  editor.commands.insertContent([
    { type: "text", text: "Target", marks: [{ type: "link", attrs: { href: "note:target" } }] },
    { type: "text", text: " ", marks: [] },
  ]);
  expect(editor.getHTML()).toContain('<div data-callout="tip"><h2>He<a');
  expect(editor.getHTML()).toContain('href="note:target"');
  expect(editor.state.doc.textContent).toBe("HeTarget llo");
});

it("inserts after a selected non-divider node, preserving all its contents", () => {
  const editor = editorFor('<div data-callout="tip"><p>Keep these words</p></div>');
  editor.commands.setNodeSelection(0);
  editor.commands.setDivider("thick");
  expect(editor.getHTML()).toBe('<div data-callout="tip"><p>Keep these words</p></div><hr data-style="thick"><p></p>');
});

it("clears formatting across callouts, headings, quotes and lists without losing words", () => {
  const editor = editorFor('<div data-callout="tip"><h2><strong>one</strong></h2><ul><li><p>two</p></li></ul></div><blockquote><p>three</p></blockquote><p>four</p>');
  editor.commands.selectAll();
  editor.chain().unsetAllMarks().clearNodes().run();
  editor.state.doc.check();
  expect(editor.state.doc.textContent).toBe("onetwothreefour");
  expect(editor.getHTML()).not.toMatch(/data-callout|<h2|<ul|<strong|<blockquote/);
});
