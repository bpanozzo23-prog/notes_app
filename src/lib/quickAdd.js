import { Transform } from "@tiptap/pm/transform";
import { noteSchema, documentFor, serializeBody, withTrailingParagraph } from "../claude/html.js";
import { dayMonth } from "./dates.js";

export function quickAddHtml(html, text, { date = false, now = new Date() } = {}) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Enter some text to add.");
  const { paragraph, listItem, bulletList, hardBreak } = noteSchema.nodes;
  // Collapse runs of spaces as the editor's HTML parsing would on the next open, so the stored
  // HTML is already in its stable form and a later add never rewrites an earlier line.
  const content = `${date ? `${dayMonth(now)} — ` : ""}${trimmed}`.split(/\r\n?|\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .flatMap((line, index) => [...(index ? [hardBreak.create()] : []), ...(line ? [noteSchema.text(line)] : [])]);
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
