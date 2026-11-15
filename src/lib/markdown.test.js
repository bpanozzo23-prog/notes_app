import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_HTML_SAMPLES } from "../editor/extensions.js";
import { noteFixture } from "../test/fixtures.js";
import { escapeMarkdown, htmlToMarkdown, noteToMarkdown } from "./markdown.js";

const md = (html, lookup) => htmlToMarkdown(html, lookup);

it.each(SUPPORTED_HTML_SAMPLES)("writes supported editor HTML as Markdown: %s", (html) => {
  const text = md(html);
  expect(text).toMatchSnapshot();
  expect(md(html)).toBe(text);
  expect(text.split("\n").every((line) => line === line.trimEnd())).toBe(true);
  expect(text).not.toMatch(/<\/?[a-z]/i);
});

it("writes every note of the public sample notebook", () => {
  const sample = JSON.parse(readFileSync(resolve(__dirname, "../../public/sample-notebook.json"), "utf8"));
  const live = new Map(sample.notes.map((note) => [note.id, note]));
  for (const note of sample.notes.filter((row) => row.deletedAt === null)) {
    expect(noteToMarkdown(note, live)).toMatchSnapshot(note.title || `untitled ${note.id}`);
  }
});

describe("the note's top", () => {
  it("puts the title first and moves the body's headings down one level, capped at six", () => {
    expect(noteToMarkdown(noteFixture({ title: "Plan", html: "<h1>One</h1><h3>Three</h3><p>Body</p>" })))
      .toBe("# Plan\n\n## One\n\n#### Three\n\nBody\n");
    expect(htmlToMarkdown("<h3>Deep</h3>", undefined, { headingOffset: 4 })).toBe("###### Deep");
  });
  it("writes an untitled note as it stands, and an empty one as its title alone", () => {
    expect(noteToMarkdown(noteFixture({ title: " ", text: "First line\nMore", html: "<h1>First line</h1><p>More</p>" })))
      .toBe("# First line\n\nMore\n");
    expect(noteToMarkdown(noteFixture({ title: "Empty", html: "<p></p>" }))).toBe("# Empty\n");
    expect(noteToMarkdown(noteFixture({ title: "", text: "", html: "<p></p>" }))).toBe("# Untitled note\n");
  });
  it("escapes a title that would read as formatting", () => {
    expect(noteToMarkdown(noteFixture({ title: "*Draft* #", html: "<p></p>" }))).toBe("# \\*Draft\\* \\#\n");
    expect(noteToMarkdown(noteFixture({ title: "Learn C#", html: "<p></p>" }))).toBe("# Learn C#\n");
  });
});

describe("escaping", () => {
  it("escapes characters Markdown reads as formatting, leaving snake_case and ordinary words alone", () => {
    expect(escapeMarkdown("a*b _c_ snake_case `x` \\ [y] ~z~ <b> &copy; 5 < 6 & 7")).toBe(
      "a\\*b \\_c\\_ snake_case \\`x\\` \\\\ \\[y\\] \\~z\\~ \\<b> \\&copy; 5 < 6 & 7");
    expect(escapeMarkdown("<123@example.com> <-")).toBe("\\<123@example.com> \\<-");
  });
  it.each([
    ["# not a heading", "\\# not a heading"], ["#hashtag", "#hashtag"], ["> not a quote", "\\> not a quote"],
    ["- not a list", "\\- not a list"], ["-5 degrees", "-5 degrees"], ["---", "\\---"], ["+ plus", "\\+ plus"],
    ["1. not numbered", "1\\. not numbered"], ["2026) year", "2026\\) year"], ["===", "\\==="], ["* star", "\\* star"],
  ])("escapes %j at the start of a line", (text, expected) => {
    expect(md(`<p>${text}</p>`)).toBe(expected);
    expect(md(`<p>First<br>${text}</p>`)).toBe(`First\\\n${expected}`);
  });
  it("keeps line-start characters in the middle of a line", () => {
    expect(md("<p>Score: 1. Next - then # and > done</p>")).toBe("Score: 1. Next - then # and > done");
  });
});

describe("inline formatting", () => {
  it("moves spaces at a mark's edges outside its markers", () => {
    expect(md("<p>a<strong> bold </strong>b</p>")).toBe("a **bold** b");
    expect(md("<p><em>lead </em>tail</p>")).toBe("*lead* tail");
  });
  it("nests overlapping marks", () => {
    expect(md("<p><strong>bold <em>both</em></strong> <em>italic</em></p>")).toBe("**bold *both*** *italic*");
    expect(md("<p><strong>bold <em>both</em> more</strong></p>")).toBe("**bold *both* more**");
    expect(md("<p><s><strong>gone</strong></s></p>")).toBe("**~~gone~~**");
  });
  it("closes and reopens crossing marks away from spaces, opening the longer one first", () => {
    expect(md("<p><strong>red </strong><em><strong>blue </strong>green</em></p>")).toBe("**red *blue*** *green*");
    expect(md("<p><em><strong>a</strong>b</em></p>")).toBe("***a**b*");
    expect(md("<p><strong>a <s>b </s></strong><s>c</s></p>")).toBe("**a ~~b~~** ~~c~~");
  });
  it("closes marks at a line break and drops what Markdown can't say", () => {
    expect(md("<p><strong>a <br>b</strong></p>")).toBe("**a**\\\n**b**");
    expect(md('<p><u>under</u> <span style="color: #dc2626">red</span> <mark>lit</mark></p>')).toBe("under red lit");
  });
  it("fences code spans around backticks and spaces", () => {
    expect(md("<p><code>a`b</code></p>")).toBe("``a`b``");
    expect(md("<p><code>`tick</code></p>")).toBe("`` `tick ``");
    expect(md("<p>a<code> padded </code>b</p>")).toBe("a`  padded  `b");
    expect(md("<p><strong>see </strong><code>x</code></p>")).toBe("**see** `x`");
  });
  it("writes web links, escaping their text and wrapping awkward addresses", () => {
    expect(md('<p><a href="https://example.com/a">[1] link</a></p>')).toBe("[\\[1\\] link](https://example.com/a)");
    expect(md('<p><a href="https://example.com/a_(b)">Wiki</a></p>')).toBe("[Wiki](<https://example.com/a_(b)>)");
    expect(md('<p>Wow!<a href="https://example.com">link</a></p>')).toBe("Wow\\![link](https://example.com)");
    expect(md('<p><a href="https://example.com"><strong>bold</strong> link</a></p>')).toBe("[**bold** link](https://example.com)");
    expect(md('<p><a href="https://example.com/?q=&amp;copy;&amp;b">x</a></p>')).toBe("[x](https://example.com/?q=\\&copy;&b)");
    expect(md('<p><a href="https://example.com/a_(b)?&amp;lt;">x</a></p>')).toBe("[x](<https://example.com/a_(b)?\\&lt;>)");
  });
  it("names linked notes: live, in Trash, missing", () => {
    const target = noteFixture({ id: "target", title: "Target *title*" });
    const html = '<p><a href="note:target">my <strong>link</strong></a>(see it)</p>';
    expect(md(html, new Map([["target", target]]))).toBe("my **link** [→ Target \\*title\\*]\\(see it)");
    expect(md(html, () => ({ ...target, deletedAt: "2026-10-18" }))).toBe("my **link** [→ a deleted note]\\(see it)");
    expect(md('<p><a href="note:missing">gone</a></p>')).toBe("gone [→ a deleted note]");
    expect(md('<p><a href="NOTE:target">See</a></p>', new Map([["target", target]]))).toBe("See [→ Target \\*title\\*]");
  });
  it("doesn't repeat a linked note's title when the link's words already are its title", () => {
    const target = noteFixture({ id: "target", title: "Frases útiles" });
    expect(md('<p>Ver <a href="note:target"><em>frases Útiles</em></a>(2)</p>', new Map([["target", target]]))).toBe("Ver *frases Útiles*(2)");
  });
});

describe("blocks", () => {
  it("indents nested lines to their parent's text", () => {
    const tens = Array.from({ length: 10 }, (_, i) => `<li><p>Item ${i + 1}</p>${i === 9 ? "<ul><li><p>Under ten</p></li></ul>" : ""}</li>`).join("");
    expect(md(`<ol>${tens}</ol>`).split("\n").slice(-2)).toEqual(["10. Item 10", "    - Under ten"]);
    expect(md('<ul><li><p>Parent</p><ol start="3"><li><p>Three</p></li></ol></li></ul>')).toBe("- Parent\n\n  3. Three");
    expect(md("<ul><li><p></p><ul><li><p>Only nested</p></li></ul></li></ul>")).toBe("-\n  - Only nested");
    expect(md("<ul><li><p></p><p>Second</p></li><li><p>Next</p></li></ul>")).toBe("-\n  Second\n- Next");
  });
  it("starts a list Markdown can't number at 1", () => {
    expect(md('<ol start="-1"><li><p>Neg</p></li><li><p>Zero</p></li></ol>')).toBe("1. Neg\n2. Zero");
    expect(md('<ol start="999999999"><li><p>A</p></li><li><p>B</p></li></ol>')).toBe("1. A\n2. B");
    expect(md('<ol start="0"><li><p>Zero</p></li></ol>')).toBe("0. Zero");
    expect(md('<ul><li><p>Parent</p><ol start="-3"><li><p>Child</p></li></ol></li></ul>')).toBe("- Parent\n  1. Child");
  });
  it("separates paragraphs inside a list line and keeps quotes and callouts around their contents", () => {
    expect(md("<ul><li><p>First</p><p>Second</p></li></ul>")).toBe("- First\n\n  Second");
    expect(md("<blockquote><p>Quote</p><ul><li><p>Item</p></li></ul></blockquote>")).toBe("> Quote\n>\n> - Item");
    expect(md("<div data-callout=\"warning\"><pre><code>x = 1</code></pre></div>")).toBe("> [!WARNING]\n> ```\n> x = 1\n> ```");
  });
  it("fences code blocks longer than the backticks inside and keeps only plain language names", () => {
    expect(md("<pre><code>```\ninner\n```</code></pre>")).toBe("````\n```\ninner\n```\n````");
    expect(md('<pre><code class="language-a`b">x</code></pre>')).toBe("```\nx\n```");
    expect(md("<pre><code>  indented\n\n*not emphasis*</code></pre>")).toBe("```\n  indented\n\n*not emphasis*\n```");
  });
  it("drops empty lines and trailing breaks, and turns heading breaks into spaces", () => {
    expect(md("<p></p><p>Text<br></p><p></p>")).toBe("Text");
    expect(md("<h2>Two<br>lines</h2><h2></h2>")).toBe("### Two lines");
    expect(md("<h2>Issue #</h2>")).toBe("### Issue \\#");
  });
});
