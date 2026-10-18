import { generateJSON } from "@tiptap/core";
import { extensions } from "../editor/extensions.js";
import { noteTitle } from "../lib/notebookView.js";

// Parse through exactly the vocabulary the editor stores. No HTML is sent or rendered.
export function noteToClaudeText(html, lookup = () => undefined, { headingOffset = 0 } = {}) {
  const find = typeof lookup === "function" ? lookup : (id) => lookup.get?.(id) ?? lookup[id];
  function inline(nodes = []) {
    const groups = [];
    for (const node of nodes) {
      const href = node.marks?.find((mark) => mark.type === "link")?.attrs.href;
      const text = node.type === "text" ? node.text : node.type === "hardBreak" ? "\n" : inline(node.content);
      if (groups.length && groups.at(-1).href === href) groups.at(-1).text += text;
      else groups.push({ href, text });
    }
    return groups.map(({ href, text }) => {
      if (!href) return text;
      if (href.startsWith("note:")) {
        const target = find(href.slice(5));
        return `${text} [→ ${target?.deletedAt === null ? noteTitle(target) : "a deleted note"}]`;
      }
      return `${text} <${href}>`;
    }).join("");
  }
  function block(node, depth = 0) {
    const children = node.content ?? [];
    switch (node.type) {
      case "paragraph": case "codeBlock": return inline(children);
      case "heading": return `${"#".repeat(Math.min(6, node.attrs.level + headingOffset))} ${inline(children)}`;
      case "image": return "[image]";
      case "divider": case "horizontalRule": return "---";
      case "blockquote": return children.map((child) => block(child, depth)).join("\n\n").split("\n").map((line) => `> ${line}`).join("\n");
      case "callout": {
        const type = node.attrs.type;
        return `[${type[0].toUpperCase()}${type.slice(1)}]\n${children.map((child) => block(child, depth)).join("\n\n")}`;
      }
      case "bulletList": case "orderedList": case "taskList":
        return children.map((item, index) => {
          const prefix = node.type === "orderedList" ? `${(node.attrs.start ?? 1) + index}. ` : node.type === "taskList" ? (item.attrs.checked ? "[x] " : "[ ] ") : "- ";
          const parts = (item.content ?? []).map((child) => /^(bullet|ordered|task)List$/.test(child.type)
            ? block(child, depth + 1) : block(child, depth).split("\n").map((line) => `${"  ".repeat(depth + 1)}${line}`).join("\n"));
          const first = parts.shift() ?? "";
          return `${"  ".repeat(depth)}${prefix}${first.trimStart()}${parts.length ? `\n${parts.join("\n")}` : ""}`;
        }).join("\n");
      default: return children.map((child) => block(child, depth)).join("\n\n");
    }
  }
  return block(generateJSON(html, extensions)).split("\n").map((line) => line.trimEnd()).join("\n").trim();
}
