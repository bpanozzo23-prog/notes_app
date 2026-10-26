import { expect, it } from "vitest";
import { SUPPORTED_HTML_SAMPLES } from "../editor/extensions.js";
import { fromClaudeHtml, normalizeBody } from "../claude/html.js";
import { auditBody, auditList } from "./audit.js";

const handles = { imageHandles: new Map([["sample-image", "sample-image"]]), noteHandles: new Map([["12345678-1234-4234-8234-123456789abc", "12345678-1234-4234-8234-123456789abc"]]) };
it.each(SUPPORTED_HTML_SAMPLES)("accepts the editor vocabulary, including its serialized form: %s", (html) => {
  expect(auditList(auditBody(html, handles))).toEqual([]);
  expect(auditList(auditBody(normalizeBody(html), handles))).toEqual([]);
});
it("reports raw scripts, unsupported styles, outside pictures and rejected addresses in plain groups", () => {
  const html = '<script>throw new Error("never run")</script><p style="text-align: center; margin: 10px">Fixture</p><img src="https://outside.invalid/picture"><p><a href="javascript:alert(1)">Unsafe</a></p>';
  expect(auditList(auditBody(html, handles))).toEqual([
    "1 script", "2 styles the app doesn't support", "1 picture from outside the note", "1 link with an address the app doesn't allow",
  ]);
  expect(document.querySelector("script")).toBeNull();
});
it("combines the raw audit and cleaner's report without counting references twice", () => {
  const html = '<img data-file="foreign"><p><a href="note:missing">Missing <strong>note</strong></a></p>';
  const cleaned = fromClaudeHtml(html, handles);
  expect(auditList(auditBody(html, handles), cleaned.report)).toEqual(["1 picture from outside the note", "1 link to a missing or trashed note"]);
  expect(auditList({}, cleaned.report)).toEqual(["1 picture from outside the note", "1 link to a missing or trashed note"]);
});
it("reports unsupported elements and attributes, including events and invalid formatting values", () => {
  expect(auditList(auditBody('<table><tr><td>Text</td></tr></table><p onclick="bad()" style="line-height: 3">Text</p><hr data-style="zigzag">', handles))).toEqual([
    "1 style the app doesn't support", "4 elements the app doesn't support", "2 attributes the app doesn't support",
  ]);
});
it("accepts a collapsed list line, but only data-collapsed=\"true\"", () => {
  expect(auditList(auditBody('<ul><li data-collapsed="true"><p>A</p><ul><li><p>B</p></li></ul></li></ul>', handles))).toEqual([]);
  expect(auditList(auditBody('<ul><li data-collapsed="yes"><p>A</p></li></ul>', handles))).toEqual(["1 attribute the app doesn't support"]);
});
it("accepts schema aliases and style marks, but not an arbitrary wrapper", () => {
  expect(auditList(auditBody('<p><b>Bold</b><i>Italic</i><del>Strike</del><span style="font-weight: bold">Bold</span></p>', handles))).toEqual([]);
  expect(auditList(auditBody("<div>Unwrapped</div>", handles))).toEqual(["1 element the app doesn't support"]);
  // Removing an unsupported wrapper doesn't remove a schema-supported bold style.
  const styled = '<div style="font-weight: bold">Unwrapped</div>';
  expect(auditList(auditBody(styled, handles))).toEqual(["1 element the app doesn't support"]);
  expect(fromClaudeHtml(styled, handles).html).toContain("<strong>Unwrapped</strong>");
});

it.each(["h1", "h2", "h3"])("accepts only true on folded %s, including callouts", (tag) => {
  const html = `<div data-callout="note"><${tag} data-collapsed="true">Section</${tag}><p>Body</p></div>`;
  expect(auditList(auditBody(html, handles))).toEqual([]);
  expect(auditList(auditBody(html.replace('data-collapsed="true"', 'data-collapsed="false"'), handles))).toEqual(["1 attribute the app doesn't support"]);
});
