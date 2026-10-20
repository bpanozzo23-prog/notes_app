// "… Ask again." plus an Ask again button would say it twice; the button carries the instruction.
export const bannerText = (message, action) => action && typeof message === "string" ? message.replace(new RegExp(` ${action.label}\\.$`), "") : message;
export default function StaleBanner({ message, action }) {
  return <div role="alert" className="my-2 rounded-[10px] bg-[var(--color-warn-bg)] px-3 py-2.5 text-[15px] leading-[1.5] text-[var(--color-warn-ink)]">
    <p>{bannerText(message, action)}</p>
    {action && <button type="button" className="min-h-11 font-semibold underline underline-offset-2" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
  </div>;
}
