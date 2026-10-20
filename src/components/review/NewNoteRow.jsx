import { useId, useState } from "react";
import ReviewRow from "./ReviewRow.jsx";
import ReadOnlyBody from "./ReadOnlyBody.jsx";
import { useOverlay } from "../../lib/overlays.jsx";
import { htmlToText } from "../../lib/text.js";

export function NewNotePreview({ model, title = model.title, titleAction, titles = new Map() }) {
  const links = model.effects.filter((effect) => ["note-link-added", "web-link-added"].includes(effect.type))
    .map(({ href }) => href.startsWith("note:") ? titles.get(href.slice(5)) ?? "Missing or trashed note" : href);
  return <div className="space-y-2">
    <div><ins className="review-added"><span className="sr-only">added: </span>{title || "Untitled"}</ins>{titleAction}</div>
    <p className="text-sm"><span className="text-[var(--color-muted)]">Folder: </span><span>{model.folder.name ?? "No folder"}{model.folder.action === "create" ? " (new folder)" : ""}</span></p>
    {!!model.tags.length && <div>{model.tags.map((tag) => <span key={tag} className="my-0.5 mr-1 inline-block rounded-full bg-[var(--color-ins-bg)] px-2.5 py-px text-[15px] text-[var(--color-ins-ink)]">+ {tag}</span>)}</div>}
    <div className="border-l-[3px] border-[var(--color-ins-ink)] pl-2.5"><ReadOnlyBody html={model.html} /></div>
    {!!links.length && <p className="text-sm text-[var(--color-muted)]">Links to: {links.join(" · ")}</p>}
  </div>;
}
export default function NewNoteRow({ model, title = model.title, onEdit, error, titles, ...props }) {
  const [editing, setEditing] = useState(false), inputId = useId(), errorId = useId();
  useOverlay(editing, () => setEditing(false));
  const words = htmlToText(model.html).trim().split(/\s+/).filter(Boolean).length;
  return <ReviewRow label={`New note · ${words} ${words === 1 ? "word" : "words"}`} {...props}>
    <NewNotePreview model={model} title={title} titles={titles} titleAction={<button type="button" className="ml-1.5 min-h-11 min-w-11 text-sm text-[var(--color-accent)]"
      aria-expanded={editing} aria-controls={inputId} disabled={props.disabled} onClick={() => setEditing(!editing)}>Edit</button>} />
    {editing && <input id={inputId} aria-label="Proposed title" aria-invalid={!!error} aria-describedby={error ? errorId : undefined} autoFocus
      className="mt-1 min-h-11 w-full rounded border border-[var(--color-line)] bg-white p-2" value={title} disabled={props.disabled} onChange={(event) => onEdit(event.target.value)} />}
    {error && <p id={errorId} role="alert" className="text-sm text-[var(--color-del-ink)]">{error}</p>}
  </ReviewRow>;
}
