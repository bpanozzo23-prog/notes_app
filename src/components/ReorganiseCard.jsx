import { notePreview } from "../claude/preview.js";
import { reorganiseRowIds } from "../claude/reorganise.js";
import NoteReviewCard from "./review/NoteReviewCard.jsx";
import TitleRow from "./review/TitleRow.jsx";
import TagsRow from "./review/TagsRow.jsx";
import FolderRow from "./review/FolderRow.jsx";

export default function ReorganiseCard({ change, note, folders, selected, title, titleError, toggle, editTitle, selectRows, disabled }) {
  const preview = notePreview(note.text), ids = reorganiseRowIds(change);
  const anyTicked = ids.some((id) => selected.has(id)), selectionLabel = anyTicked ? "Untick all" : "Tick all";
  const row = (field) => ({ checked: selected.has(`${change.note}:${field}`), onToggle: () => toggle(`${change.note}:${field}`), disabled });
  return <NoteReviewCard title={note.displayTitle} reason={change.reason}
    action={{ label: selectionLabel, ariaLabel: `${selectionLabel} in ${note.displayTitle}`, tone: "accent", disabled, onClick: () => selectRows(ids, !anyTicked) }}>
    {/* An untitled note is already headed by its first line; don't repeat it. */}
    {preview !== note.displayTitle && <p className="my-1 text-sm text-[var(--color-muted)]">{preview}</p>}
    <div>
      {change.title !== null && <TitleRow {...row("title")} before={note.title} title={title} onEdit={editTitle} error={titleError} inputLabel={`Proposed title for ${note.displayTitle}`} />}
      {change.folder.action !== "keep" && <FolderRow {...row("folder")} before={folders.find((folder) => folder.id === note.folderId)?.name ?? "No folder"} after={change.folder.name ?? "No folder"} isNew={change.folder.action === "create"} />}
      {!!(change.addTags.length || change.removeTags.length) && <TagsRow {...row("tags")} added={change.addTags} removed={change.removeTags} />}
    </div>
  </NoteReviewCard>;
}
