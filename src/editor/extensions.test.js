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
