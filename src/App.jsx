import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { createNote, purgeExpired, trashNote, updateNote } from "./db/notes.js";
import { SaveQueue } from "./lib/saveQueue.js";
import { requestPersistence } from "./lib/persistence.js";
import useNotebook from "./lib/useNotebook.js";
import { activeEntry, createNavigationController, initialNavigation } from "./lib/navigation.js";
import { resolveFormatting } from "./editor/formatting.js";
import { notebookAccess, ReadOnlyNotebookError, NotebookReplacedError, DATABASE_UPDATED } from "./db/db.js";
import NotesList from "./screens/NotesList.jsx";
import Note from "./screens/Note.jsx";
import Folders from "./screens/Folders.jsx";
import Trash from "./screens/Trash.jsx";
import Settings from "./screens/Settings.jsx";
import { DialogLock } from "./components/Dialog.jsx";
import { OverlayNavigation } from "./lib/overlays.jsx";
import ToolbarSettings from "./screens/settings/ToolbarSettings.jsx";
import PopupSettings from "./screens/settings/PopupSettings.jsx";

export default function App() {
  const [queue] = useState(() => new SaveQueue({ save: updateNote }));
  const status = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const access = useSyncExternalStore(notebookAccess.subscribe, notebookAccess.getSnapshot);
  const notebook = useNotebook();
  const formatting = useMemo(() => resolveFormatting(notebook.prefs), [notebook.prefs]);
  const { refresh } = notebook;
  const [navigation, setNavigation] = useState(initialNavigation);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [databaseUpdateError, setDatabaseUpdateError] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [waitingForReload, setWaitingForReload] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const activatedWorker = useRef(false);
  const [registrationError, setRegistrationError] = useState("");
  const [nav] = useState(() => createNavigationController({
    prepare: async () => {
      const current = notebookAccess.getSnapshot();
      if (current.replaced) throw new NotebookReplacedError();
      if (current.versionChange) throw new Error(DATABASE_UPDATED);
      await queue.flush(); return refresh();
    },
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
    const stopMessages = notebookAccess.listen();
    const stopAccess = notebookAccess.subscribe(() => {
      if (notebookAccess.getSnapshot().replaced) queue.block(new NotebookReplacedError());
    });
    // The blank boot screen's scroll must not overwrite the saved visit before rows load.
    void nav.run(async () => {
      try {
        await notebookAccess.load();
        if (!notebookAccess.getSnapshot().readOnly) await purgeExpired();
        nav.restore(await refresh());
        setReady(true);
      } catch (error) { setBootError(error.message || String(error)); }
    }, { captureScroll: false });
    const flush = () => { queue.flush().catch(() => {}); };
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      stop();
      stopMessages();
      stopAccess();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [nav, queue, refresh]);

  useEffect(() => {
    if (access.versionChange !== "pending" || access.replaced) return;
    // A failed flush leaves this state unchanged, so only an explicit Retry tries again.
    void finishDatabaseUpdate();
  }, [access.versionChange, access.replaced, queue]);

  async function finishDatabaseUpdate() {
    try {
      await notebookAccess.flushAndClose(() => queue.flush());
      setDatabaseUpdateError(null);
    } catch (error) { setDatabaseUpdateError(error); }
  }

  const route = activeEntry(navigation);
  useLayoutEffect(() => { if (ready) window.scrollTo(0, route.scrollY); }, [route.key, route.screen, ready]);
  useEffect(() => {
    if (!offlineReady) return;
    const timer = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  // Consume once; a failed flush stays visible until an explicit retry, never a reload loop.
  useEffect(() => {
    if (!workerReady || busy || access.versionChange || access.replaced) return;
    setWorkerReady(false);
    void nav.run(async () => {
      try { await queue.flush(); window.location.reload(); }
      finally { setWaitingForReload(false); }
    });
  }, [workerReady, busy, nav, queue, access.versionChange, access.replaced]);

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
  const locked = busy || !ready || waitingForReload || workerReady || !!access.versionChange || access.replaced;
  const shared = { busy: locked, readOnly: access.readOnly, onBack: back, run, refresh, error };
  const guardMessage = access.replaced ? new NotebookReplacedError().message : access.readOnly ? new ReadOnlyNotebookError().message
    : access.versionChange === "closed" ? DATABASE_UPDATED : "";
  function retrySave() {
    return run(() => access.versionChange === "pending" ? finishDatabaseUpdate() : queue.flush());
  }
  const selected = notebook.notes.find((note) => note.id === route.noteId);
  return <OverlayNavigation value={nav}><DialogLock value={access.replaced || !!access.versionChange}><main className="mx-auto flex min-h-dvh max-w-2xl flex-col">
    {guardMessage && <aside role="alert" className="border-b border-[var(--color-line)] bg-amber-50 px-4 py-2 text-sm">{guardMessage}</aside>}
    {bootError !== null && <div role="alert" className="mx-4 my-3 text-red-700">
      <p>Couldn't open your notes. They have not been deleted. Reload to try again.</p>
      <p className="mt-1 text-sm">{bootError}</p>
    </div>}
    {(needRefresh || activatedWorker.current) && <aside aria-label="App update" className="border-b border-[var(--color-line)] bg-blue-50 px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2"><span>Update available —</span><button className="min-h-11 underline" disabled={locked || saveBlocksReload} onClick={reload}>Reload</button></div>
      {reloadReason && <p className="text-xs">{reloadReason}</p>}
      {waitingForReload && <p className="text-xs">Reloading…</p>}
    </aside>}
    {offlineReady && <p role="status" className="bg-green-50 px-4 py-2 text-sm">Ready to work offline</p>}
    {error && <p role="alert" className="mx-4 my-3 text-sm text-red-700">{error}</p>}
    {!access.replaced && (status === "error" || databaseUpdateError) && <div role="alert" className="mx-4 my-3 text-sm text-red-700">
      <p>Not saved. {queue.error?.message ?? databaseUpdateError?.message}</p>
      <button className="min-h-11 underline" disabled={busy || access.replaced || access.versionChange === "closed" || waitingForReload} onClick={retrySave}>Retry save</button>
    </div>}
    {message && <p role="status" className="mx-4 my-3 text-sm">{message}</p>}
    {ready && <div className="flex flex-1 flex-col" inert={locked} aria-busy={locked}>
      {route.screen === "list" && <NotesList key={route.key} {...notebook} busy={locked} readOnly={access.readOnly} trashCount={notebook.trash.length} filter={route.filter} query={route.query} onQuery={nav.setQuery} onFilter={nav.setFilter} onOpen={open} onNew={() => run(newNote)} />}
      {route.screen === "note" && selected && <Note key={route.key} {...shared} initialNote={selected} notes={notebook.notes} folders={notebook.folders} queue={queue} status={status} onDelete={deleteNote} onOpenNote={openNote}
        formatting={formatting} />}
      {route.screen === "folders" && <Folders {...notebook} {...shared} />}
      {route.screen === "trash" && <Trash trash={notebook.trash} {...shared} />}
      {route.screen === "settings" && <Settings {...shared} notebook={notebook} queue={queue} onOpen={open} setMessage={setMessage} updateState={updateState} />}
      {route.screen === "settings-toolbar" && <ToolbarSettings {...shared} formatting={formatting} />}
      {route.screen === "settings-selection" && <PopupSettings {...shared} formatting={formatting} />}
    </div>}
  </main></DialogLock></OverlayNavigation>;
}
