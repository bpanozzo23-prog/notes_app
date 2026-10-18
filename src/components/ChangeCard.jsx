import { useEditor, EditorContent } from "@tiptap/react";
import { extensions } from "../editor/extensions.js";
import { parseBody } from "../claude/html.js";

export function ReadOnlyBody({ html }) {
  const editor = useEditor({ extensions, content: parseBody(html || "<p></p>"), editable: false,
    editorProps: { attributes: { "aria-label": "Proposal preview", tabindex: "-1" },
      handleDOMEvents: { click: (_view, event) => { event.preventDefault(); return true; } },
    },
  }, [html]);
  return <div className="claude-preview" onClickCapture={(event) => event.preventDefault()} onAuxClickCapture={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()}><EditorContent editor={editor} /></div>;
}
function wordsLabel(parts) {
  const result = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const words = (value) => value.replace(/\s+/g, " ").trim();
    if (part.removed && parts[index + 1]?.added) result.push(`${words(part.value)} → ${words(parts[++index].value)}`);
    else if (part.removed && words(part.value)) result.push(`− ${words(part.value)}`);
    else if (part.added && words(part.value)) result.push(`+ ${words(part.value)}`);
  }
  return result.join(" · ");
}
export function effectLabel(effect, titles) {
  const target = (href) => href?.startsWith("note:") ? titles.get(href.slice(5)) ?? "Missing or trashed note" : href;
  if (effect.type === "image-removed") return "Removes an image";
  if (effect.type === "image-added") return "Adds an image";
  if (effect.type === "link-retargeted") return `Link now points to ${target(effect.after)} (was ${target(effect.before)})`;
  if (effect.type === "link-removed") return `Removes a link to ${target(effect.href)}`;
  if (effect.type === "note-link-added") return `Adds a note link: ${target(effect.href)}`;
  return `Adds a web link: ${effect.href}`;
}
export default function ChangeCard({ change, index, total, checked, onToggle, disabled, titles }) {
  // The editor's end-of-note empty line is saved but not worth showing as blank space.
  const shown = (blocks) => { const list = [...blocks]; while (list.length > 1 && list.at(-1) === "<p></p>") list.pop(); return list; };
  // When the shape changed (a paragraph became a list), a word-by-word line is noise: Before and
  // After and the formatting label say it better.
  const structural = change.formatting.some((label) => label.startsWith("now "));
  return <article aria-label={`Change ${index} of ${total}`} className="space-y-3 rounded-lg border border-[var(--color-line)] p-3">
    <label className="flex min-h-11 items-center gap-3 font-semibold"><input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled} />Change {index} of {total}</label>
    <div className="rounded bg-black/5 p-2"><h3 className="text-sm font-semibold">− Before</h3>{change.before.length ? <ReadOnlyBody html={shown(change.before).join("")} /> : <p className="text-sm">Nothing here</p>}</div>
    <div className="rounded bg-blue-50 p-2"><h3 className="text-sm font-semibold">+ After</h3>{change.after.length ? <ReadOnlyBody html={shown(change.after).join("")} /> : <p className="text-sm">Removed</p>}</div>
    {!!change.words.length && !structural && <p className="text-sm whitespace-pre-wrap">Words: {wordsLabel(change.words)}</p>}
    {!!change.formatting.length && <p className="text-sm">Formatting: {change.formatting.join(" · ")}</p>}
    {change.effects.map((effect, index) => <p className="text-sm font-medium" key={index}>{effectLabel(effect, titles)}</p>)}
  </article>;
}
