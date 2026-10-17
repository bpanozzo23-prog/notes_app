import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { createNote, purgeExpired, trashNote, updateNote } from "./db/notes.js";
import { SaveQueue } from "./lib/saveQueue.js";
import { requestPersistence } from "./lib/persistence.js";
import useNotebook from "./lib/useNotebook.js";
import { activeEntry, createNavigationController, initialNavigation } from "./lib/navigation.js";
import { DEFAULT_TOOLBAR } from "./editor/actions.js";
import NotesList from "./screens/NotesList.jsx";
import Note from "./screens/Note.jsx";
import Folders from "./screens/Folders.jsx";
import Trash from "./screens/Trash.jsx";
import Settings from "./screens/Settings.jsx";

export default function App() {
  const [queue] = useState(() => new SaveQueue({ save: updateNote }));
  const status = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const notebook = useNotebook();
  const { refresh } = notebook;
  const [navigation, setNavigation] = useState(initialNavigation);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [waitingForReload, setWaitingForReload] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const activatedWorker = useRef(false);
  const [registrationError, setRegistrationError] = useState("");
  const [nav] = useState(() => createNavigationController({
    prepare: async () => { await queue.flush(); return refresh(); },
    onChange: setNavigation,
    onBusy: setBusy,
    onError: (error) => setError(error.message || "The operation failed. Please try again."),
  }));
  const { needRefresh: [needRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    // Guard the final controller-change reload too: activation can come from another tab.
    onNeedReload: () => { activatedWorker.current = true; setWorkerReady(true); },
    onRegisterError: (error) => setRegistrationError(error.message || "Offline setup failed. Reopen the app to try again."),
  });

  useEffect(() => {
    const stop = nav.start();
    // The blank boot screen's scroll must not overwrite the saved visit before rows load.
    void nav.run(async () => { await purgeExpired(); nav.restore(await refresh()); setReady(true); }, { captureScroll: false });
    const flush = () => { queue.flush().catch(() => {}); };
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [nav, queue, refresh]);

  const route = activeEntry(navigation);
  useLayoutEffect(() => { if (ready) window.scrollTo(0, route.scrollY); }, [route.key, route.screen, ready]);
  useEffect(() => {
    if (!offlineReady) return;
    const timer = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  // Consume once; a failed flush stays visible until an explicit retry, never a reload loop.
  useEffect(() => {
    if (!workerReady || busy) return;
    setWorkerReady(false);
    void nav.run(async () => {
      try { await queue.flush(); window.location.reload(); }
      finally { setWaitingForReload(false); }
    });
  }, [workerReady, busy, nav, queue]);

  function run(task) {
    setMessage(""); setError("");
    return nav.run(task);
  }
  function open(entry) { setMessage(""); setError(""); void nav.open(entry); }
  function openNote(noteId) {
    if (notebook.notes.some((note) => note.id === noteId)) open({ screen: "note", noteId });
    else setMessage(notebook.trash.some((note) => note.id === noteId)
      ? "That note is in the Trash. Restore it from the Trash to open it."
      : "That note no longer exists.");
  }
  function back() { setMessage(""); setError(""); nav.back(); }
  async function newNote() {
    await queue.flush();
    const currentFilter = activeEntry(nav.current).filter;
    const created = await createNote({ folderId: currentFilter?.type === "folder" ? currentFilter.value : null });
    await requestPersistence();
    await refresh();
    nav.openCreated(created.id);
  }
  async function deleteNote(id) {
    const success = await run(async () => { await queue.flush(); await trashNote(id); await refresh(); });
    if (success && activeEntry(nav.current).screen === "note") nav.back();
  }
  const saveBlocksReload = ["pending", "saving", "error"].includes(status);
  const reloadReason = status === "error" ? "Save failed. Retry save before reloading." : saveBlocksReload ? "Waiting for your notes to save." : "";
  const updateState = registrationError ? `Offline setup: ${registrationError}` : needRefresh || activatedWorker.current
    ? `Update available.${reloadReason ? ` ${reloadReason}` : " Ready to reload."}` : offlineReady ? "Ready to work offline" : "No update waiting.";
  async function reload() {
    // Check the queue itself as well as the rendered button, in case a keystroke just arrived.
    if (queue.status !== "idle") return;
    await run(async () => {
      await queue.flush();
      if (activatedWorker.current) { window.location.reload(); return; }
      setWaitingForReload(true);
      try { await updateServiceWorker(true); }
      catch (error) { setWaitingForReload(false); throw error; }
    });
  }
  const locked = busy || waitingForReload || workerReady;
  const shared = { busy: locked, onBack: back, run, refresh, error };
  const selected = notebook.notes.find((note) => note.id === route.noteId);
  return <main className="mx-auto flex min-h-dvh max-w-2xl flex-col">
    {(needRefresh || activatedWorker.current) && <aside aria-label="App update" className="border-b border-[var(--color-line)] bg-blue-50 px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2"><span>Update available —</span><button className="min-h-11 underline" disabled={locked || saveBlocksReload} onClick={reload}>Reload</button></div>
      {reloadReason && <p className="text-xs">{reloadReason}</p>}
      {waitingForReload && <p className="text-xs">Reloading…</p>}
    </aside>}
    {offlineReady && <p role="status" className="bg-green-50 px-4 py-2 text-sm">Ready to work offline</p>}
    {error && <p role="alert" className="mx-4 my-3 text-sm text-red-700">{error}</p>}
    {status === "error" && <div role="alert" className="mx-4 my-3 text-sm text-red-700">
      <p>Not saved. {queue.error?.message}</p>
      <button className="min-h-11 underline" disabled={locked} onClick={() => run(() => queue.flush())}>Retry save</button>
    </div>}
    {message && <p role="status" className="mx-4 my-3 text-sm">{message}</p>}
    <div className="flex flex-1 flex-col" inert={locked} aria-busy={locked}>
      {route.screen === "list" && <NotesList key={route.key} {...notebook} busy={locked} trashCount={notebook.trash.length} filter={route.filter} query={route.query} onQuery={nav.setQuery} onFilter={nav.setFilter} onOpen={open} onNew={() => run(newNote)} />}
      {route.screen === "note" && selected && <Note key={route.key} {...shared} initialNote={selected} notes={notebook.notes} folders={notebook.folders} queue={queue} status={status} onDelete={deleteNote} onOpenNote={openNote}
        toolbarIds={Array.isArray(notebook.prefs.toolbar) ? notebook.prefs.toolbar : DEFAULT_TOOLBAR} />}
      {route.screen === "folders" && <Folders {...notebook} {...shared} />}
      {route.screen === "trash" && <Trash trash={notebook.trash} {...shared} />}
      {route.screen === "settings" && <Settings {...shared} notebook={notebook} queue={queue} setMessage={setMessage} updateState={updateState} />}
    </div>
  </main>;
}
