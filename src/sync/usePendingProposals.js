import { useEffect, useState, useSyncExternalStore } from "react";
import { liveQuery } from "dexie";
import { syncSession } from "./session.js";
import { readOutbox, readHandled } from "./prefs.js";
import { pendingProposals } from "./inbox.js";

export default function usePendingProposals() {
  const { proposals } = useSyncExternalStore(syncSession.subscribe, syncSession.getSnapshot);
  const [pending, setPending] = useState([]);
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const hidden = [...await readOutbox(), ...await readHandled()];
      return { pending: pendingProposals(proposals, hidden), hidden };
    }).subscribe({
      next({ pending, hidden }) { syncSession.hideProposals(hidden); setPending(pending); },
      error() { setPending([]); },
    });
    return () => subscription.unsubscribe();
  }, [proposals]);
  return pending;
}
