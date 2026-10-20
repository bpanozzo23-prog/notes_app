export default function ReviewActionBar({ primary, secondary }) {
  return <div role="group" aria-label="Review actions" className="fixed inset-x-0 bottom-0 z-20 flex gap-2.5 border-t border-[var(--color-line)] bg-[var(--color-paper)] px-4 pt-2.5 pb-[calc(18px+env(safe-area-inset-bottom))] text-[17px] leading-[1.5]">
    {secondary && <button type="button" className="min-h-12 rounded-lg border border-[var(--color-line)] bg-white px-4 py-2" disabled={secondary.disabled} onClick={secondary.onClick}>{secondary.label}</button>}
    {primary && <button type="button" className="min-h-12 min-w-0 flex-1 rounded-lg border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 text-[var(--color-paper)]" disabled={primary.disabled} onClick={primary.onClick}>{primary.label}</button>}
  </div>;
}
