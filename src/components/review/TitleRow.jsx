import { useId, useState } from "react";
import ReviewRow from "./ReviewRow.jsx";

export default function TitleRow({ before, title, onEdit, error, inputLabel = "Proposed title", reason, checked, onToggle, disabled }) {
  const [editing, setEditing] = useState(false), inputId = useId(), errorId = useId();
  return <ReviewRow label="Title" checkboxLabel={`Title: ${before || "Untitled"} → ${title || "Untitled"}`} checked={checked} onToggle={onToggle} disabled={disabled} reason={reason}>
    <div><ins className="review-added"><span className="sr-only">added: </span>{title || "Untitled"}</ins>
      <button type="button" className="ml-1.5 min-h-11 min-w-11 text-sm text-[var(--color-accent)]" aria-expanded={editing} aria-controls={inputId} disabled={disabled} onClick={() => setEditing(!editing)}>Edit</button>
    </div>
    <p className="text-sm text-[var(--color-muted)]">was: {before || "Untitled"}</p>
    {editing && <input id={inputId} aria-label={inputLabel} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} autoFocus
      className="mt-1 min-h-11 w-full rounded border border-[var(--color-line)] bg-white p-2" value={title} disabled={disabled} onChange={(event) => onEdit(event.target.value)} />}
    {error && <p id={errorId} role="alert" className="text-sm text-[var(--color-del-ink)]">{error}</p>}
  </ReviewRow>;
}
