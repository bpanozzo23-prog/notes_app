import { useId, useState } from "react";
import ReviewRow from "./ReviewRow.jsx";
import ReadOnlyBody from "./ReadOnlyBody.jsx";
import { useOverlay } from "../../lib/overlays.jsx";

export default function TrashRow({ model, ...props }) {
  const [expanded, setExpanded] = useState(false), previewId = useId();
  useOverlay(expanded, () => setExpanded(false));
  return <ReviewRow label={<span className="text-[var(--color-del-ink)]">Move to Trash</span>} {...props}>
    <p>It stays in Trash for 30 days. Undo, or Restore in Trash, brings it back.</p>
    {!!model.backlinks.length && <p className="mt-1 text-sm text-[var(--color-muted)]">Linked from: {model.backlinks.join(", ")} (their links stay)</p>}
    <button type="button" className="min-h-11 text-sm text-[var(--color-accent)]" aria-expanded={expanded} aria-controls={previewId} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide the note" : "Show the note"}</button>
    {expanded && <div id={previewId}><ReadOnlyBody html={model.html} /></div>}
  </ReviewRow>;
}
