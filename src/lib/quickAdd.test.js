import { expect, it } from "vitest";
import { quickAddHtml } from "./quickAdd.js";
import { normalizeBody } from "../claude/html.js";

const item = (text) => `<li><p>${text}</p></li>`;
const bullets = (text) => `<ul>${item(text)}</ul>`;
const inbox = (children = "", label = "Inbox", attrs = "") => `<ul><li${attrs}><p>${label}</p>${children}</li></ul>`;
const added = bullets("Fresh");
const check = (input, expected) => {
  const output = quickAddHtml(input, "  Fresh  ");
  expect(output).toBe(normalizeBody(expected));
  expect(normalizeBody(output)).toBe(output);
};
it("prepends to the immediate bullet sublist", () => check(inbox(bullets("Old")), inbox(`<ul>${item("Fresh")}${item("Old")}</ul>`)));
it("creates a sublist under an Inbox without children", () => check(inbox(), inbox(added)));
it.each([
  `<ol start="4">${item("Numbered")}</ol>`,
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Task</p></li></ul>',
  `<p>Keep this paragraph</p>${bullets("Later")}`,
])("inserts before other children without replacing them: %s", (children) => check(inbox(children), inbox(added + children)));
it("finds a checklist Inbox and preserves its checked state", () => {
  const before = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Inbox</p></li></ul>';
  check(before, before.replace("</p>", `</p>${added}`));
});
it.each([1, 2, 3])("adds immediately after an h%s Inbox, before its other blocks", (level) => {
  const heading = `<h${level}>Inbox</h${level}>`;
  check(`${heading}${bullets("Old")}<p>Keep</p>`, `${heading}<ul>${item("Fresh")}${item("Old")}</ul><p>Keep</p>`);
  check(`${heading}<p>Keep</p>`, `${heading}${added}<p>Keep</p>`);
});
it("creates an Inbox at the top and keeps the original trailing paragraph", () => check("<p>Original</p><p></p>", inbox(added) + "<p>Original</p><p></p>"));
it("matches only the whole trimmed, case-folded line and uses the first Inbox in document order", () => {
  check(inbox("", "INBOX ") + "<h2>Inbox</h2><p>Last</p>", inbox(added, "INBOX ") + "<h2>Inbox</h2><p>Last</p>");
  check(inbox("", "Inbox items"), inbox(added) + inbox("", "Inbox items"));
});
it.each([inbox(bullets("Old"), "Inbox", ' data-collapsed="true"'), '<h2 data-collapsed="true">Inbox</h2><p>Keep</p>'])("keeps a folded Inbox folded", (html) => {
  expect(quickAddHtml(html, "Fresh")).toContain('data-collapsed="true"');
});
it("prefixes the date and turns internal newlines into breaks in one item, with literal text", () => {
  const output = quickAddHtml(inbox(), " first\n\n<second>\r\nthird ", { date: true, now: new Date(2026, 9, 26, 12) });
  expect(output).toBe(normalizeBody(inbox(bullets("26 Oct — first<br><br>&lt;second&gt;<br>third"))));
});
it.each(["", "  ", "\n\t"])("refuses blank text: %j", (text) => expect(() => quickAddHtml("<p>Keep</p>", text)).toThrow());
it("preserves all formatting, links, images and folds outside the inserted item", () => {
  const input = inbox(bullets("Old"), "Inbox", ' data-collapsed="true"') +
    '<p style="line-height: 1.5;"><span style="color: #15803d; font-size: 17pt; font-family: serif;"><strong>Colour and size</strong></span> <mark data-color="#fde68a" style="background-color: #fde68a; color: inherit;">Highlight</mark> <a href="note:target">Note link</a></p>' +
    '<div data-callout="tip"><p>Callout</p></div><img data-file="fixture-image" width="480" height="270" alt="Fixture">' +
    '<ul><li data-collapsed="true"><p>Folded</p><ol><li><p>Hidden</p></li></ol></li></ul><h2 data-collapsed="true">Section</h2><p>Hidden section</p>';
  const output = quickAddHtml(input, "Fresh");
  expect(output.replace(item("Fresh"), "")).toBe(normalizeBody(input));
  expect(normalizeBody(output)).toBe(output);
});
it("stores added text in its parse-stable form, so a later add never rewrites an earlier line", () => {
  const first = quickAddHtml("<p>Keep</p>", "A  B\n  indented\tline  ");
  expect(first).toContain(item("A B<br>indented line"));
  const second = quickAddHtml(first, "Next");
  expect(second).toContain(item("A B<br>indented line"));
  expect(second.replace(item("Next"), "")).toBe(first);
});
