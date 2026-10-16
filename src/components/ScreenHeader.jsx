import { ArrowLeft } from "lucide-react";

export default function ScreenHeader({ title, onBack, busy, children }) {
  return <header className="flex min-w-0 items-center gap-2 px-3 py-2">
    <button className="icon-button" aria-label="Back" disabled={busy} onClick={onBack}><ArrowLeft size={22} aria-hidden="true" /></button>
    <h1 className="min-w-0 flex-1 font-semibold">{title}</h1>
    {children}
  </header>;
}
