export default function NoteReviewCard({ title, reason, action, children }) {
  return <article aria-label={title} className="my-3.5 rounded-[14px] border border-[var(--color-line)] bg-white px-3.5 pt-1.5 pb-2">
    <div className="mt-1.5 mb-0.5 flex items-center justify-between gap-2">
      <h2 className="min-w-0 break-words text-[19px] font-semibold">{title}</h2>
      {action && <button type="button" className={`min-h-11 shrink-0 py-2.5 text-[15px] ${action.tone === "accent" ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`}
        aria-label={action.ariaLabel} disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
    </div>
    {reason && <p className="mt-0.5 text-sm text-[var(--color-muted)]">“{reason}”</p>}
    {children}
  </article>;
}
