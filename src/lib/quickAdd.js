import { Transform } from "@tiptap/pm/transform";
import { noteSchema, documentFor, serializeBody, withTrailingParagraph } from "../claude/html.js";
import { isAllowedLink } from "../editor/extensions.js";
import { dayMonth } from "./dates.js";

// A web address in an added line becomes the editor's own link, under the editor's own rule
// (https only). Sentence punctuation after it stays outside, and so does a closing bracket that
// closes nothing inside the address.
const ADDRESS = /https:\/\/[^\s<>"]+/gi;
const unopened = (href) => ["()", "[]", "{}"].some(([open, close]) => href.endsWith(close) && href.split(close).length > href.split(open).length);
function linked(line) {
  const out = [];
  let last = 0;
  for (const match of line.matchAll(ADDRESS)) {
    let href = match[0];
    while (/[.,;:!?'"”’»…]$/.test(href) || unopened(href)) href = href.slice(0, -1);
    if (!URL.canParse(href) || !isAllowedLink(href)) continue;
    if (match.index > last) out.push(noteSchema.text(line.slice(last, match.index)));
    out.push(noteSchema.text(href, [noteSchema.marks.link.create({ href })]));
    last = match.index + href.length;
  }
  if (last < line.length) out.push(noteSchema.text(line.slice(last)));
  return out;
}

export function quickAddHtml(html, text, { date = false, now = new Date() } = {}) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Enter some text to add.");
  const { paragraph, listItem, bulletList, hardBreak } = noteSchema.nodes;
  // Collapse runs of spaces (form feeds too) and drop NUL as the editor's HTML parsing would on
  // the next open, so the stored HTML is already in its stable form and a later add never
  // rewrites an earlier line.
  const content = `${date ? `${dayMonth(now)} — ` : ""}${trimmed}`.split(/\r\n?|\n/)
    .map((line) => line.replace(/\u0000/g, "").replace(/[ \t\f]+/g, " ").trim())
    .flatMap((line, index) => [...(index ? [hardBreak.create()] : []), ...linked(line)]);
  const item = listItem.create(null, paragraph.create(null, content));
  const tr = new Transform(documentFor(html));
  let inbox;
  tr.doc.descendants((node, pos) => {
    if (inbox) return false;
    const heading = node.type.name === "heading";
    const line = heading ? node : ["listItem", "taskItem"].includes(node.type.name) ? node.firstChild : null;
    if (line?.textContent.trim().toLowerCase() === "inbox") { inbox = { node, pos, heading }; return false; }
  });
  if (inbox) {
    const { node, pos, heading } = inbox;
    const at = heading ? pos + node.nodeSize : pos + 1 + node.firstChild.nodeSize;
    const next = tr.doc.resolve(at).nodeAfter;
    // Only the immediate bullet list belongs to Inbox; other children stay in place.
    tr.insert(next?.type === bulletList ? at + 1 : at, next?.type === bulletList ? item : bulletList.create(null, item));
  } else tr.insert(0, bulletList.create(null, listItem.create(null, [paragraph.create(null, noteSchema.text("Inbox")), bulletList.create(null, item)])));
  return serializeBody(withTrailingParagraph(tr.doc.toJSON()));
}
