import { useSyncExternalStore } from "react";
import { claudeSession } from "../claude/session.js";
export default function ClaudeReadyBar({ screen, onOpen, busy }) {
  const { proposal } = useSyncExternalStore(claudeSession.subscribe, claudeSession.getSnapshot);
  if (screen === "claude-review" || proposal?.status !== "ready" || proposal.dismissed) return null;
  return <aside role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] bg-blue-50 px-4 py-2 text-sm">
    <button className="min-h-11 text-left underline" disabled={busy} onClick={() => onOpen({ screen: "claude-review" })}>{proposal.kind === "duplicates" ? "Claude's suggestions are ready · Review" : "Claude's proposal is ready · Review"}</button>
    <button className="min-h-11" disabled={busy} onClick={() => claudeSession.updateProposal(proposal.id, { dismissed: true })}>Dismiss</button>
  </aside>;
}
