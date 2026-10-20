import { useId } from "react";
import { Check } from "lucide-react";

export default function ReviewRow({ label, checkboxLabel, checked, onToggle, disabled = false, reason, chips, children }) {
  const labelId = useId(), reasonId = useId();
  return <div className={`review-row grid grid-cols-[32px_minmax(0,1fr)] items-start gap-2 border-t border-[var(--color-line)] py-2.5 first:border-t-0 ${disabled ? "opacity-55" : ""}`}>
    <label className="-mt-2 -ml-[11px] flex size-11 items-center justify-center">
      <span className="relative flex">
        <input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled}
          aria-label={checkboxLabel} aria-labelledby={checkboxLabel ? undefined : labelId} aria-describedby={reason ? reasonId : undefined}
          className="peer size-[22px] appearance-none rounded-[6px] border-2 border-[var(--color-tick-border)] bg-white checked:border-[var(--color-accent)] checked:bg-[var(--color-accent)] disabled:border-[var(--color-tick-disabled)] disabled:checked:bg-[var(--color-tick-disabled)]" />
        <Check size={16} strokeWidth={3} aria-hidden="true" className="pointer-events-none absolute top-[3px] left-[3px] hidden text-white peer-checked:block" />
      </span>
    </label>
    <div className="min-w-0 break-words text-[17px] leading-[1.5]">
      <div className="flex flex-wrap items-center gap-x-1">
        <span id={labelId} className="text-[13px] font-semibold tracking-[.04em] text-[var(--color-muted)] uppercase">{label}</span>
        {!!chips?.length && <span aria-hidden="true" className="text-[13px] text-[var(--color-muted)]">·</span>}
        {chips}
      </div>
      {children}
      {reason && <p id={reasonId} className="mt-0.5 text-sm text-[var(--color-muted)]">{reason}</p>}
    </div>
  </div>;
}
