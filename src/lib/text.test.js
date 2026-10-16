// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractNoteLinks, firstLine, htmlToText, neutralizeNoteLinks, normalize } from "./text.js";

it("projects paragraphs, headings, nested lists and hard breaks without a DOM", () => {
  expect(typeof document).toBe("undefined");
  expect(htmlToText('<h1>Heading</h1><p>One <b>bold</b><br>two</p><ul><li><p>A</p><ul><li>B</li></ul></li><li>C</li></ul>'))
    .toBe("Heading\nOne bold\ntwo\nA\nB\nC");
});
it("decodes entities after stripping tags, and omits scripts and comments", () => {
  expect(htmlToText('<p>&amp; &lt;b&gt; &quot; &#39; &nbsp; &#241; &#xF1;</p><!--hidden--><script>bad()</script><style>p{}</style>'))
    .toBe('& <b> " \'   ñ ñ');
  expect(htmlToText("&amp;lt;")).toBe("&lt;");
  expect(htmlToText("")).toBe("");
});
it("normalises Spanish accents and case and finds the first nonblank line", () => {
  expect(normalize("ÁRBOL, pingüino, NIÑO")).toBe("arbol, pinguino, nino");
  expect(firstLine("\n  \n  First  \r\nSecond")).toBe("First");
  expect(firstLine("")).toBe("");
});
describe("note links", () => {
  const html = `<a class="x" href="note:one">One</a><a href='note:two'>Two</a><a href=note:one>Again</a><a href="https://example.com">Web</a><a data-href="note:no" title='href="note:nope"'>No</a>`;
  it("extracts only href attributes on anchors and deduplicates", () => {
    expect(extractNoteLinks(html)).toEqual(["one", "two"]);
    expect(extractNoteLinks('<div href="note:no"></div><A HREF="note:&#111;ne">Yes</A>')).toEqual(["one"]);
    expect(extractNoteLinks('<a href="note:">Empty</a>')).toEqual([]);
  });
  it("neutralises only matching hrefs, preserving markup and visible text", () => {
    const cleaned = neutralizeNoteLinks(html, new Set(["one"]));
    expect(cleaned).toContain('<a class="x">One</a>');
    expect(cleaned).toContain("<a>Again</a>");
    expect(cleaned).toContain('data-href="note:no"');
    expect(extractNoteLinks(cleaned)).toEqual(["two"]);
    expect(htmlToText(cleaned)).toBe(htmlToText(html));
  });
});
