import { Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { db } from "../db/db.js";
import { checkGeneration, deepFreeze } from "./payload.js";
import { noteTitle } from "../lib/notebookView.js";
import { extractNoteLinks } from "../lib/text.js";
import { noteToClaudeText } from "./projection.js";
import { noteSchema, parseBody, serializeBody, withTrailingParagraph } from "./html.js";
import { nullableString, shape, runProposal } from "./proposals.js";
import { LINKS_SYSTEM_PROMPT } from "./prompts.js";
import { CLAUDE_MODEL, PROPOSAL_EFFORT, PROPOSAL_MAX_TOKENS } from "./config.js";
import { RESPONSE_ERRORS } from "./client.js";
import { STALE_REORGANISE } from "./reorganise.js";

export const LINKS_TASK = "Suggest links between related notes in this notebook.";
const properties = { from: { type: "string" }, to: { type: "string" }, phrase: nullableString, reason: { type: "string" } };
export const LINKS_SCHEMA = { type: "object", properties: { summary: { type: "string" }, links: { type: "array", items: {
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
} } }, required: ["summary", "links"], additionalProperties: false };

export async function captureLinksPayload() {
  return db.transaction("r", db.notes, db.prefs, async () => {
    const generation = await checkGeneration();
    const live = await db.notes.filter((note) => note.deletedAt === null).toArray();
    live.sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const lookup = new Map(live.map((note) => [note.id, note]));
    const notes = live.map((note, index) => {
      const linked = new Set(extractNoteLinks(note.html));
      return { ...Object.fromEntries(["id", "rev", "updatedAt", "title", "html"].map((key) => [key, note[key]])),
        handle: `N${index + 1}`, displayTitle: noteTitle(note), text: noteToClaudeText(note.html, lookup),
        linksTo: live.flatMap((target, i) => linked.has(target.id) ? [`N${i + 1}`] : []) };
    });
    const requestText = JSON.stringify({ task: LINKS_TASK, notes: notes.map(({ handle, displayTitle, text, linksTo }) => ({ handle, title: displayTitle, text, linksTo })) });
    return deepFreeze({ kind: "links", generation, capturedAt: new Date().toISOString(), notes, requestText, system: LINKS_SYSTEM_PROMPT });
  });
}
export function buildLinksRequest(payload) {
  return { model: CLAUDE_MODEL, max_tokens: PROPOSAL_MAX_TOKENS, output_config: { effort: PROPOSAL_EFFORT, format: { type: "json_schema", schema: LINKS_SCHEMA } },
    system: payload.system, messages: [{ role: "user", content: payload.requestText }] };
}
const documentFor = (html) => Node.fromJSON(noteSchema, parseBody(html));
export function findLinkPlacement(html, phrase) {
  if (!phrase) return { kind: "see-also" };
  const matches = [];
  documentFor(html).descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (node.type.spec.code) return false;
    let search = "", real = "";
    node.forEach((child) => {
      search += child.isText && !child.marks.some((mark) => ["link", "code"].includes(mark.type.name)) ? child.text : "\u0000".repeat(child.nodeSize);
      real += child.isText ? child.text : " ".repeat(child.nodeSize);
    });
    for (let i = search.indexOf(phrase); i !== -1; i = search.indexOf(phrase, i + 1)) {
      // Positions use UTF-16 offsets; boundaries use whole Unicode characters, including astral letters.
      const before = Array.from(search.slice(0, i)).at(-1) ?? "", after = Array.from(search.slice(i + phrase.length))[0] ?? "";
      if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
      const end = i + phrase.length;
      matches.push({ kind: "inline", from: pos + 1 + i, to: pos + 1 + end,
        before: `${i > 40 ? "…" : ""}${real.slice(Math.max(0, i - 40), i)}`, match: phrase,
        after: `${real.slice(end, end + 40)}${real.length > end + 40 ? "…" : ""}` });
    }
    return false;
  });
  return matches.length === 1 ? matches[0] : { kind: "see-also" };
}
export function validateLinksProposal(raw, payload) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    if (!shape(value, LINKS_SCHEMA) || value.links.length > 30) throw new Error();
    const notes = new Map(payload.notes.map((note) => [note.handle, note])), seen = new Set(), ranges = new Map();
    value.links = value.links.flatMap((link) => {
      const source = notes.get(link.from), pair = `${link.from}>${link.to}`;
      if (!source || !notes.has(link.to)) throw new Error();
      if (link.from === link.to || source.linksTo.includes(link.to) || seen.has(pair)) return [];
      seen.add(pair);
      const phrase = link.phrase?.trim();
      link.phrase = !phrase || phrase.length > 100 || /[\u0000-\u001f\u007f-\u009f]/.test(link.phrase) ? null : phrase;
      link.reason = link.reason.trim();
      let placement = findLinkPlacement(source.html, link.phrase);
      const earlier = ranges.get(link.from) ?? [];
      if (placement.kind === "inline") {
        if (earlier.some((range) => placement.from < range.to && placement.to > range.from)) placement = { kind: "see-also" };
        else { earlier.push(placement); ranges.set(link.from, earlier); }
      }
      return [{ ...link, placement }];
    });
    value.noChanges = !value.links.length;
    return deepFreeze(value);
  } catch { throw new Error(RESPONSE_ERRORS.invalid); }
}
// The plan resolves handles to targetId locally; no raw id comes from Claude.
export function applyLinksToHtml(html, links, titleFor) {
  const tr = new Transform(documentFor(html));
  const markFor = (link) => noteSchema.marks.link.create({ href: `note:${link.targetId}` });
  for (const link of links) if (link.placement.kind === "inline") tr.addMark(link.placement.from, link.placement.to, markFor(link));
  const extras = links.filter((link) => link.placement.kind === "see-also");
  if (extras.length) {
    const content = extras.flatMap((link, index) => [...(index ? [noteSchema.text(" · ")] : []), noteSchema.text(titleFor(link.to), [markFor(link)])]);
    let last, lastPos = 0;
    tr.doc.forEach((node, pos) => { if (node.type.name !== "paragraph" || node.content.size) { last = node; lastPos = pos; } });
    if (last?.type.name === "paragraph" && last.textContent.startsWith("See also:")) {
      tr.insert(lastPos + last.nodeSize - 1, [noteSchema.text(last.textContent === "See also:" ? " " : " · "), ...content]);
    } else tr.insert(last ? lastPos + last.nodeSize : 0, noteSchema.nodes.paragraph.create(null, [noteSchema.text("See also: "), ...content]));
  }
  return serializeBody(withTrailingParagraph(tr.doc.toJSON()));
}
export const linksItemIds = (proposal) => proposal.links.map(({ from, to }) => `${from}>${to}`);
export function linksPlan(payload, proposal, ticked) {
  const selected = new Set(ticked), lookup = new Map(payload.notes.map((note) => [note.handle, note]));
  const handles = [...new Set([...proposal.links.map((link) => link.from), ...proposal.links.map((link) => link.to)])];
  const notes = handles.map((handle) => {
    const note = lookup.get(handle), links = proposal.links.filter((link) => link.from === handle && selected.has(`${link.from}>${link.to}`))
      .map((link) => ({ ...link, targetId: lookup.get(link.to).id }));
    return { id: note.id, expectedRev: note.rev, patch: links.length ? { html: applyLinksToHtml(note.html, links, (target) => lookup.get(target).displayTitle) } : {} };
  });
  return { generation: payload.generation, kind: "links", notes, folderChecks: [], createFolders: [] };
}
export const runLinks = (options) => runProposal({ ...options, buildRequest: buildLinksRequest, validate: validateLinksProposal, staleMessage: STALE_REORGANISE });
