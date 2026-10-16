import { useCallback, useRef, useState } from "react";
import { allPrefs } from "../db/db.js";
import { allFolders } from "../db/folders.js";
import { liveNotes, trashedNotes } from "../db/notes.js";

export default function useNotebook() {
  const [notebook, setNotebook] = useState({ notes: [], trash: [], folders: [], prefs: {}, persisted: undefined });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const [notes, trash, folders, prefs] = await Promise.all([liveNotes(), trashedNotes(), allFolders(), allPrefs()]);
    const actual = await navigator.storage?.persisted?.().catch(() => undefined);
    const persisted = navigator.storage?.persist ? actual ?? prefs.storagePersisted : "unavailable";
    const next = { notes, trash, folders, prefs, persisted };
    if (request === generation.current) setNotebook(next);
    return next;
  }, []);
  return { ...notebook, refresh };
}
