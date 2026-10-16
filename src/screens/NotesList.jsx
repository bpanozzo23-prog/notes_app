import { Folder, Settings, Search, Plus, Pin, Trash2 } from "lucide-react";
import { noteTitle, tagsInUse, visibleNotes } from "../lib/notebookView.js";

export default function NotesList({ notes, folders, trashCount, filter, onFilter, onOpen, onNew, busy }) {
  const chips = [{ label: "All", filter: { type: "all" } },
    ...folders.map((folder) => ({ label: folder.name, filter: { type: "folder", value: folder.id } })),
    ...tagsInUse(notes).map((tag) => ({ label: `#${tag}`, filter: { type: "tag", value: tag } }))];
  const visible = visibleNotes(notes, filter);
  return <section className="pb-24">
    <header className="px-4 pt-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <div className="flex">
          <button className="icon-button" aria-label="Folders" disabled={busy} onClick={() => onOpen({ screen: "folders" })}><Folder size={21} aria-hidden="true" /></button>
          <button className="icon-button" aria-label="Settings" disabled={busy} onClick={() => onOpen({ screen: "settings" })}><Settings size={21} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="my-3 flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 text-[var(--color-muted)]" title="search arrives in 1c">
        <Search size={18} aria-hidden="true" /><input aria-label="Search notes" title="search arrives in 1c" disabled placeholder="Search notes" className="min-h-11 min-w-0 w-full bg-transparent text-sm" />
      </div>
    </header>
    <div role="group" aria-label="Filter notes" className="flex gap-2 overflow-x-auto px-4 pb-3">
      {chips.map((chip) => <button key={`${chip.filter.type}:${chip.filter.value ?? ""}`} className="filter-chip"
        disabled={busy} aria-pressed={filter.type === chip.filter.type && filter.value === chip.filter.value}
        onClick={() => onFilter(chip.filter)}>{chip.label}</button>)}
    </div>
    <ul aria-label="Notes" className="divide-y divide-[var(--color-line)] px-4">
      {visible.map((note) => <li key={note.id}>
        <button aria-label={noteTitle(note)} className="block w-full py-4 text-left" disabled={busy} onClick={() => onOpen({ screen: "note", noteId: note.id })}>
          <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{noteTitle(note)}</span>{note.pinned && <Pin size={16} aria-label="Pinned" className="shrink-0 text-[var(--color-accent)]" />}</span>
          <span className="mt-1 block truncate text-sm text-[var(--color-muted)]">{note.text.replace(/\s+/g, " ") || "Empty note"}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1 text-xs text-[var(--color-muted)]">
            <span className="mr-1 max-w-full truncate">{folders.find((folder) => folder.id === note.folderId)?.name ?? "No folder"}</span>
            {note.tags.map((tag) => <span key={tag} className="tag-chip max-w-full break-all px-2 py-0.5">#{tag}</span>)}
          </span>
        </button>
      </li>)}
    </ul>
    {!busy && !visible.length && <p className="px-4 py-10 text-center text-[var(--color-muted)]">{notes.length ? "No notes in this filter." : "No notes yet."}</p>}
    <button className="mx-4 mt-4 flex min-h-11 items-center gap-2 text-sm text-[var(--color-muted)]" disabled={busy} onClick={() => onOpen({ screen: "trash" })}>
      <Trash2 size={16} aria-hidden="true" />Trash{trashCount > 0 ? ` (${trashCount})` : ""}
    </button>
    <div className="pointer-events-none fixed inset-x-0 bottom-6 mx-auto flex max-w-2xl justify-end px-5 pb-[env(safe-area-inset-bottom)]">
      <button className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-ink)] text-[var(--color-paper)] shadow-lg"
        aria-label="+ New note" disabled={busy} onClick={onNew}><Plus size={27} aria-hidden="true" /></button>
    </div>
  </section>;
}
