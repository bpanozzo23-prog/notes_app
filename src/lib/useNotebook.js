import { useCallback, useRef, useState } from "react";
import { allPrefs } from "../db/db.js";
import { allFolders } from "../db/folders.js";
import { liveNotes, trashedNotes } from "../db/notes.js";

import { CLAUDE_PREFS } from "../claude/prefs.js";

export default function useNotebook() {
  const [notebook, setNotebook] = useState({ notes: [], trash: [], folders: [], prefs: {}, persisted: undefined });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const [notes, trash, folders, prefs] = await Promise.all([liveNotes(), trashedNotes(), allFolders(), allPrefs()]);
    const actual = await navigator.storage?.persisted?.().catch(() => undefined);
    const persisted = navigator.storage?.persist ? actual ?? prefs.storagePersisted : "unavailable";
    for (const key of CLAUDE_PREFS) delete prefs[key];
    const next = { notes, trash, folders, prefs, persisted };
    if (request === generation.current) setNotebook(next);
    return next;
  }, []);
  return { ...notebook, refresh };
}
