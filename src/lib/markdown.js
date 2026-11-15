import { generateJSON } from "@tiptap/core";
import { extensions } from "../editor/extensions.js";
import { noteTitle } from "./notebookView.js";

// One note as a Markdown file (Copy as text, Share…, Save as .md). Separate from
// src/claude/projection.js on purpose: Claude's requests and the XPS notebook.md keep their format.
// Markdown can't say underline, colour, highlight, size, typeface or line spacing; those drop.

const FORMATS = ["bold", "italic", "strike"];
const DELIMITERS = { bold: "**", italic: "*", strike: "~~" };
const WORD = /[\p{L}\p{N}]/u;

export function escapeMarkdown(text) {
  return text
    .replace(/[\\`*~[\]]/g, "\\$&")
    // snake_case stays readable: an underscore between letters or digits can't start emphasis.
    .replace(/_/g, (match, index, all) => WORD.test(all[index - 1] ?? "") && WORD.test(all[index + 1] ?? "") ? match : "\\_")
    // "<" followed by text could start HTML or an autolink (<b>, <123@example.com>).
    .replace(/<(?=\S)/g, "\\<")
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&");
}

// Text that would start a block (heading, quote, list, setext underline) at the start of a line.
function escapeLineStart(line) {
  return line
    .replace(/^#{1,6}(?=[ \t]|$)/, "\\$&")
    .replace(/^>/, "\\>")
    .replace(/^-(?=[-\s]|$)/, "\\-")
    .replace(/^\+(?=[ \t]|$)/, "\\+")
    .replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, "$1\\$2")
    .replace(/^(=+[ \t]*)$/, "\\$1");
}

// A run of # at the end of a heading would be read as its closing sequence.
const headingText = (text) => text.replace(/(^|\s)(#+)(\s*)$/, "$1\\$2$3").trim();

function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(text) || (/^ .*[^ ].* $/s.test(text)) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function linkDestination(href) {
  const wrapped = /[\s()<>\\]/.test(href) ? `<${href.replace(/[<>\\]/g, "\\$&")}>` : href;
  // "&copy;" in an address would be read as ©.
  return wrapped.replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&");
}

// Flatten inline nodes into pieces: text with bold/italic/strike, code, or a line break.
function pieces(nodes) {
  const result = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") { result.push({ kind: "break" }); continue; }
    if (node.type !== "text") { result.push(...pieces(node.content ?? [])); continue; }
    const types = new Set((node.marks ?? []).map((mark) => mark.type));
    if (types.has("code")) result.push({ kind: "code", text: node.text });
    else result.push({ kind: "text", text: node.text, marks: FORMATS.filter((type) => types.has(type)) });
  }
  return result;
}

const marksOf = (piece) => piece?.kind === "text" ? piece.marks : [];
const shared = (a, b) => a.filter((type) => b.includes(type));

// Spaces at a mark's edge move outside its markers: "** bold **" is not bold in Markdown.
function moveEdgeSpaces(list) {
  const out = [];
  list.forEach((piece, index) => {
    if (piece.kind !== "text" || !piece.marks.length) { out.push(piece); return; }
    const before = marksOf(list[index - 1]), after = marksOf(list[index + 1]);
    const [, lead, core, trail] = piece.text.match(/^(\s*)(.*?)(\s*)$/s);
    if (!core) { out.push({ ...piece, marks: shared(shared(piece.marks, before), after) }); return; }
    if (lead) out.push({ kind: "text", text: lead, marks: shared(piece.marks, before) });
    out.push({ ...piece, text: core });
    if (trail) out.push({ kind: "text", text: trail, marks: shared(piece.marks, after) });
  });
  const merged = [];
  for (const piece of out) {
    const last = merged.at(-1);
    if (piece.kind === "text" && last?.kind === "text" && last.marks.join() === piece.marks.join()) last.text += piece.text;
    else merged.push({ ...piece });
  }
  return merged;
}

// Markers form a stack, so overlapping marks close and reopen. A mark that lasts longer opens
// first, and markers never sit against a space ("**red *blue*** *green*", not "*blue**** green*").
function emit(list) {
  const items = moveEdgeSpaces(list);
  const lasts = items.map(() => ({}));
  for (let index = items.length - 1; index >= 0; index -= 1) {
    for (const type of marksOf(items[index])) lasts[index][type] = 1 + (lasts[index + 1]?.[type] ?? 0);
  }
  let out = "";
  const open = [];
  const closeTo = (keep) => {
    if (open.length <= keep) return;
    const kept = out.trimEnd(), space = out.slice(kept.length);
    out = kept;
    while (open.length > keep) out += DELIMITERS[open.pop()];
    out += space;
  };
  items.forEach((piece, index) => {
    if (piece.kind === "break") { closeTo(0); out += "\n"; return; }
    if (piece.kind === "code") { closeTo(0); out += codeSpan(piece.text); return; }
    let keep = 0;
    while (keep < open.length && piece.marks.includes(open[keep])) keep += 1;
    closeTo(keep);
    let text = escapeMarkdown(piece.text);
    const opening = piece.marks.filter((type) => !open.includes(type))
      .sort((a, b) => lasts[index][b] - lasts[index][a]);
    if (opening.length) {
      const space = text.match(/^\s*/)[0];
      out += space;
      text = text.slice(space.length);
    }
    for (const type of opening) { open.push(type); out += DELIMITERS[type]; }
    out += text;
  });
  closeTo(0);
  return out;
}

function inline(nodes = [], find) {
  const groups = [];
  for (const node of nodes) {
    const href = node.marks?.find((mark) => mark.type === "link")?.attrs.href ?? null;
    if (groups.length && groups.at(-1).href === href) groups.at(-1).nodes.push(node);
    else groups.push({ href, nodes: [node] });
  }
  let out = "", afterNoteLink = false;
  for (const { href, nodes: members } of groups) {
    let text = emit(pieces(members));
    // "[→ Title](…" or "Wow![link](…" would turn into a link or an image.
    if (afterNoteLink && text.startsWith("(")) text = `\\${text}`;
    afterNoteLink = false;
    if (!href) { out += text; continue; }
    if (/^note:/i.test(href)) {
      const target = find(href.slice(5));
      const title = target?.deletedAt === null ? noteTitle(target) : "a deleted note";
      // Words that already are the note's title aren't repeated: "see Recipes", not "see Recipes [→ Recipes]".
      const words = members.map((node) => node.text ?? "").join("").trim();
      if (words.toLocaleLowerCase() === title.toLocaleLowerCase()) { out += text; continue; }
      out += `${text} [→ ${escapeMarkdown(title)}]`;
      afterNoteLink = true;
      continue;
    }
    if (out.endsWith("!")) out = `${out.slice(0, -1)}\\!`;
    out += `[${text}](${linkDestination(href)})`;
  }
  return out;
}

// A paragraph's lines: trimmed (indentation would start a code block), escaped at their start,
// joined by backslash line breaks (trailing double spaces get trimmed by editors).
function paragraph(text) {
  const lines = text.split("\n").map((line) => escapeLineStart(line.trim()));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join("\\\n");
}

const prefixLines = (text, first, rest) => text.split("\n").map((line, index) =>
  index === 0 ? `${first}${line}`.trimEnd() : line ? `${rest}${line}` : rest.trimEnd()).join("\n");

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

// A list can follow its item's first line directly only if it may interrupt a paragraph.
const interrupts = (node) => node.type === "bulletList" || node.type === "taskList" || (node.type === "orderedList" && listStart(node) === 1);

// Markdown numbers lists from 0 to 999999999; a list it can't number starts at 1.
function listStart(node) {
  const start = node.attrs?.start ?? 1;
  const last = start + (node.content?.length ?? 1) - 1;
  return Number.isInteger(start) && start >= 0 && last <= 999_999_999 ? start : 1;
}

export function htmlToMarkdown(html, lookup = () => undefined, { headingOffset = 1 } = {}) {
  const find = typeof lookup === "function" ? lookup : (id) => lookup.get?.(id) ?? lookup[id];
  const blocks = (nodes = []) => nodes.map(block).filter(Boolean).join("\n\n");
  function block(node) {
    const children = node.content ?? [];
    switch (node.type) {
      case "paragraph": return paragraph(inline(children, find));
      case "heading": {
        const text = headingText(inline(children, find).replace(/\s*\n\s*/g, " "));
        return text ? `${"#".repeat(Math.min(6, node.attrs.level + headingOffset))} ${text}` : "";
      }
      case "codeBlock": {
        const text = children.map((child) => child.text ?? "").join("");
        const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
        const fence = "`".repeat(Math.max(3, longest + 1));
        const language = /^[\w+#.-]+$/.test(node.attrs?.language ?? "") ? node.attrs.language : "";
        return `${fence}${language}\n${text}${text && !text.endsWith("\n") ? "\n" : ""}${fence}`;
      }
      case "image": return "[image]";
      case "divider": case "horizontalRule": return "---";
      case "blockquote": { const inner = blocks(children); return inner ? prefixLines(inner, "> ", "> ") : ""; }
      case "callout": {
        const inner = blocks(children);
        return `> [!${node.attrs.type.toUpperCase()}]${inner ? `\n${prefixLines(inner, "> ", "> ")}` : ""}`;
      }
      case "bulletList": case "orderedList": case "taskList":
        return children.map((item, index) => {
          const marker = node.type === "orderedList" ? `${listStart(node) + index}. `
            : node.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}] ` : "- ";
          const indent = " ".repeat(node.type === "orderedList" ? marker.length : 2);
          let body = "", previous = null;
          // An empty first line still holds the marker, so what follows stays under it ("-\n  - x");
          // a blank line straight after a bare marker would end the item.
          (item.content ?? []).forEach((child, position) => {
            const text = block(child);
            if (!text && position > 0) return;
            if (previous) body += !body || (previous.type === "paragraph" && LISTS.has(child.type) && interrupts(child)) ? "\n" : "\n\n";
            body += text;
            previous = child;
          });
          return prefixLines(body, marker, indent);
        }).join("\n");
      default: return blocks(children);
    }
  }
  return block(generateJSON(html, extensions));
}

// "# Title" then the body one heading level down. An untitled note's name is its first line,
// so it is written as it stands instead of repeating that line as a heading.
export function noteToMarkdown(note, lookup) {
  const titled = !!note.title.trim();
  const body = htmlToMarkdown(note.html, lookup, { headingOffset: titled ? 1 : 0 });
  if (!titled && body) return `${body}\n`;
  return `# ${headingText(escapeMarkdown(noteTitle(note)))}\n${body ? `\n${body}\n` : ""}`;
}
