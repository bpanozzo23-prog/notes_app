import { useSyncExternalStore } from "react";
import { syncSession } from "../sync/session.js";
import usePendingProposals from "../sync/usePendingProposals.js";

export default function SyncBar({ onOpen, busy }) {
  const { confirm } = useSyncExternalStore(syncSession.subscribe, syncSession.getSnapshot);
  const proposals = usePendingProposals();
  if (!confirm && !proposals.length) return null;
  return <aside role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] bg-blue-50 px-4 py-2 text-sm">
    <button className="min-h-11 text-left underline" disabled={busy} onClick={() => onOpen({ screen: confirm ? "settings-sync" : "sync-review" })}>
      {confirm ? "The XPS copy needs your decision · Review" : `Claude Code suggests changes to ${proposals.length} ${proposals.length === 1 ? "note" : "notes"} · Review`}
    </button>
  </aside>;
}
