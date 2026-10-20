import { useEffect, useState, useSyncExternalStore } from "react";
import { liveQuery } from "dexie";
import { syncSession } from "./session.js";
import { readOutbox } from "./prefs.js";
import { pendingProposals } from "./inbox.js";

export default function usePendingProposals() {
  const { proposals } = useSyncExternalStore(syncSession.subscribe, syncSession.getSnapshot);
  const [outbox, setOutbox] = useState(null);
  useEffect(() => {
    const subscription = liveQuery(readOutbox).subscribe({
      next(entries) { syncSession.hideProposals(entries); setOutbox(entries); },
      error() { setOutbox(null); },
    });
    return () => subscription.unsubscribe();
  }, []);
  return outbox === null ? [] : pendingProposals(proposals, outbox);
}
