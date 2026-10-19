import { notePreview } from "../claude/preview.js";
import { reorganiseRowIds } from "../claude/reorganise.js";

export default function ReorganiseCard({ change, note, folders, selected, title, titleError, toggle, editTitle, untick, disabled }) {
  const preview = notePreview(note.text);
  const row = (field, text) => <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={selected.has(`${change.note}:${field}`)} disabled={disabled} onChange={() => toggle(`${change.note}:${field}`)} />{text}</label>;
  return <article aria-label={note.displayTitle} className="space-y-2 rounded-lg border border-[var(--color-line)] p-3">
    <h2 className="text-lg font-semibold">{note.displayTitle}</h2>
    {/* An untitled note is already headed by its first line; don't repeat it. */}
    {preview !== note.displayTitle && <p className="text-sm text-[var(--color-muted)]">{preview}</p>}
    <p className="text-sm">{change.reason}</p>
    {change.title !== null && <div>
      {row("title", `Title: ${note.title || "(untitled)"} → ${title || "(untitled)"}`)}
      <input aria-label={`Proposed title for ${note.displayTitle}`} className="min-h-11 w-full rounded border p-2" value={title} disabled={disabled} onChange={(event) => editTitle(event.target.value)} />
      {titleError && <p role="alert">{titleError}</p>}
    </div>}
    {change.folder.action !== "keep" && row("folder", `Folder: ${folders.find((folder) => folder.id === note.folderId)?.name ?? "No folder"} → ${change.folder.name ?? "No folder"}${change.folder.action === "create" ? " (new folder)" : ""}`)}
    {!!(change.addTags.length || change.removeTags.length) && row("tags", `Tags: ${[...change.addTags.map((tag) => `+ ${tag}`), ...change.removeTags.map((tag) => `− ${tag}`)].join(" ")}`)}
    <button className="app-button text-sm" disabled={disabled} onClick={() => untick(reorganiseRowIds(change))}>Untick this note</button>
  </article>;
}
