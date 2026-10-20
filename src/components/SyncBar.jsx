import { useSyncExternalStore } from "react";
import { syncSession } from "../sync/session.js";

export default function SyncBar({ onOpen, busy }) {
  const { confirm } = useSyncExternalStore(syncSession.subscribe, syncSession.getSnapshot);
  // Phase 4c's proposals bar belongs here, after the copy decision.
  if (!confirm) return null;
  return <aside role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] bg-blue-50 px-4 py-2 text-sm">
    <button className="min-h-11 text-left underline" disabled={busy} onClick={() => onOpen({ screen: "settings-sync" })}>The XPS copy needs your decision · Review</button>
  </aside>;
}
