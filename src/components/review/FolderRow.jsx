import ReviewRow from "./ReviewRow.jsx";

export default function FolderRow({ before, after, isNew = false, ...props }) {
  return <ReviewRow label="Folder" checkboxLabel={`Folder: ${before} → ${after}${isNew ? " (new folder)" : ""}`} {...props}>
    <p>{before}<span className="mx-1 text-[var(--color-muted)]">→</span><span>{after}{isNew ? " (new folder)" : ""}</span></p>
  </ReviewRow>;
}
