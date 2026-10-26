import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { searchNotes } from "../lib/notebookView.js";
import { setSearch, searchState, revealSearchMatch } from "./nodes/SearchHighlight.js";
import { EditorContent, useEditor } from "@tiptap/react";
import { extensions } from "./extensions.js";
import ImageViewer from "./ImageViewer.jsx";
import { createImageInserter, reserveImagePosition, removeImagePosition, imageFiles } from "./imageInsertion.js";
import { notebookAccess } from "../db/db.js";
import ActionButton from "./ActionButton.jsx";
import StyleEditor from "../screens/settings/StyleEditor.jsx";
import { captureLook, applyLook } from "./look.js";
import { resolveFormatting } from "./formatting.js";
import Toolbar from "./Toolbar.jsx";
import SelectionMenu from "./SelectionMenu.jsx";
import Tray, { TRAYS } from "./Tray.jsx";
import { useVisibleViewport } from "./useToolbarSize.js";
import { useOverlay } from "../lib/overlays.jsx";
import { DialogLock } from "../components/Dialog.jsx";

function NoteDocument({ find, findShown, onFindShown, onClearFind, queue, onImageError, note, onChange, toolbarIds, formatting, readOnly = false, busy = false, run, refresh, error, ui, onEditor }) {
  const input = useRef(null), pickerPosition = useRef(null), inserter = useRef(null);
  const [adding, setAdding] = useState(0), [imageErrors, setImageErrors] = useState([]), [viewImage, setViewImage] = useState(null);
  const current = useRef({});
  const [painterLook, setPainterLook] = useState(null);
  const [styleDraft, setStyleDraft] = useState(null);
  const [openTray, setOpenTray] = useState(null);
  const [trayOptions, setTrayOptions] = useState({});
  const viewport = useVisibleViewport();
  const dock = useRef(null);
  const [dockHeight, setDockHeight] = useState(0);
  const locked = useContext(DialogLock);
  current.current = { readOnly, locked, busy, onImageError };
  const mayStart = () => {
    const access = notebookAccess.getSnapshot();
    return !current.current.readOnly && !current.current.locked && !current.current.busy &&
      !access.readOnly && !access.replaced && !access.versionChange;
  };
  const closeTray = () => setOpenTray(null);
  useOverlay(!!openTray && !locked && !readOnly, closeTray);
  useEffect(() => { if (locked || readOnly || busy) { setOpenTray(null); setPainterLook(null); } }, [locked, readOnly, busy]);
  useEffect(() => {
    if (!openTray) return;
    const escape = (event) => { if (event.key === "Escape") { event.preventDefault(); setOpenTray(null); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [openTray]);
  const initialHtml = useRef(note.html);
  const editor = useEditor({
    extensions,
    content: initialHtml.current,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "px-4 pb-4 pt-2", "aria-label": "Note body",
        autocorrect: "on", autocapitalize: "sentences", spellcheck: "true",
      },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData);
        if (!files.length) return false;
        if (mayStart()) inserter.current?.insert(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = imageFiles(event.dataTransfer);
        if (!files.length) return false;
        if (mayStart()) {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
          inserter.current?.insert(files, reserveImagePosition(editor, pos));
        }
        return true;
      },
      // Internal links use the guarded app navigation, never the browser's URL handler.
      handleClick: (_view, _pos, event) => {
        const href = event.target.closest?.("a[href]")?.getAttribute("href");
        if (/^note:/i.test(href ?? "")) { event.preventDefault(); ui?.openNote?.(href.slice(5)); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  const [found, setFound] = useState({ count: 0, current: 0, hadMatches: false, hidden: false });
  const titleMatch = !!find && searchNotes([{ title: note.title, text: "" }], find).length > 0;
  const firstJump = useRef(false), imageJump = useRef(null), searchLayout = useRef({}), findSpace = useRef(0);
  // Leave room to centre the last line. Keep that room for this visit when Close
  // removes the fixed bar, so the browser cannot clamp the owner's scroll upward.
  if (find) findSpace.current = Math.max(findSpace.current, (viewport.height + dockHeight) / 2);
  searchLayout.current = { viewport, dockHeight };
  function updateFound(hidden = false) {
    const state = searchState(editor);
    setFound((old) => ({ count: state.ranges.length, current: state.current,
      hadMatches: old.hadMatches || state.ranges.length > 0, hidden }));
  }
  function centerMatch(onlyIfOutside = false) {
    const element = editor.view.dom.querySelector(".search-match-current");
    if (!element) return false;
    const rect = element.getBoundingClientRect(), { viewport, dockHeight } = searchLayout.current;
    const top = viewport.top, bottom = top + viewport.height - dockHeight;
    if (onlyIfOutside && rect.top >= top && rect.bottom <= bottom) return false;
    window.scrollTo({ top: Math.max(0, window.scrollY + (rect.top + rect.bottom - top - bottom) / 2), behavior: "instant" });
    return true;
  }
  function showMatch(index) {
    imageJump.current = null;
    const state = setSearch(editor, find, index);
    const hidden = revealSearchMatch(editor, state.ranges[state.current], mayStart() && !queue.blocked && !document.querySelector('[role="dialog"]'));
    updateFound(hidden);
    if (!hidden) centerMatch();
    return !hidden && state.ranges.length > 0;
  }
  useEffect(() => {
    if (!editor) return;
    firstJump.current = false;
    imageJump.current = null;
    setSearch(editor, find);
    setFound({ count: searchState(editor).ranges.length, current: 0, hadMatches: searchState(editor).ranges.length > 0 || titleMatch, hidden: false });
    const updated = () => { imageJump.current = null; updateFound(); };
    editor.on("update", updated);
    return () => { editor.off("update", updated); imageJump.current = null; };
  }, [editor, find]);
  useEffect(() => {
    if (!editor || !find || findShown || firstJump.current || busy || locked) return;
    // App restores history scroll in a layout effect. Wait for that and dock measurement.
    const frame = requestAnimationFrame(() => {
      firstJump.current = true;
      if (showMatch(0)) imageJump.current = { scrollY: window.scrollY };
      onFindShown?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, find, findShown, busy, locked]);
  useEffect(() => {
    if (!editor || !find) return;
    let frame;
    const cancel = () => { imageJump.current = null; };
    const scroll = () => { if (imageJump.current && Math.abs(window.scrollY - imageJump.current.scrollY) > 1) cancel(); };
    const loaded = (event) => {
      const current = editor.view.dom.querySelector(".search-match-current");
      if (!imageJump.current || event.target.tagName !== "IMG" || !current ||
          !(event.target.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (imageJump.current && centerMatch(true)) cancel();
      });
    };
    editor.view.dom.addEventListener("load", loaded, true);
    window.addEventListener("scroll", scroll, { passive: true });
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown", "beforeinput"]) window.addEventListener(type, cancel, { passive: true });
    return () => {
      cancel(); cancelAnimationFrame(frame);
      editor.view.dom.removeEventListener("load", loaded, true);
      window.removeEventListener("scroll", scroll);
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown", "beforeinput"]) window.removeEventListener(type, cancel);
    };
  }, [editor, find]);
  useEffect(() => {
    if (!editor) return;
    const controller = createImageInserter({ editor, queue, onPending: setAdding, mayStart,
      canInsert: () => {
        const access = notebookAccess.getSnapshot();
        // The pending upgrade locks new input, but its drain must save tracked images.
        return !current.current.readOnly && !access.readOnly && !access.replaced &&
          (access.versionChange === "pending" || (!current.current.locked && !access.versionChange));
      },
      report: (message) => { setImageErrors((errors) => [...errors, message]); current.current.onImageError?.(message); },
    });
    inserter.current = controller;
    return () => { controller.dispose(); inserter.current = null; };
  }, [editor, queue]);
  useEffect(() => {
    const field = input.current;
    if (!field || !editor) return;
    // React's delegated cancel handler covers dialogs, not the file input's native event.
    const cancel = () => {
      if (pickerPosition.current) removeImagePosition(editor, pickerPosition.current);
      pickerPosition.current = null;
    };
    field.addEventListener("cancel", cancel);
    return () => field.removeEventListener("cancel", cancel);
  }, [editor]);
  useEffect(() => { onEditor?.(editor); return () => onEditor?.(null); }, [editor, onEditor]);
  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);
  useLayoutEffect(() => {
    if (!editor || !dock.current) return;
    const measure = () => setDockHeight(dock.current.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(dock.current);
    return () => observer?.disconnect();
  }, [editor, openTray, painterLook, find, found.count, found.hidden, viewport.height, formatting?.toolbarLayout]);
  function toggleTray(name, options = {}) {
    if (readOnly || locked || busy || !TRAYS[name]) return;
    setOpenTray(openTray === name && trayOptions.source === options.source ? null : name);
    setTrayOptions(options);
  }
  function applyPainter() {
    if (readOnly || locked || busy || !painterLook || editor.state.selection.empty) return;
    applyLook(editor, painterLook);
    setPainterLook(null);
  }
  const editorUi = { ...ui, openTray, dockHeight, readOnly: readOnly || locked || busy, traySource: trayOptions.source, toggleTray,
    viewImage: () => {
      const node = editor.state.selection.node;
      if (mayStart() && node?.type.name === "image") setViewImage({ ...node.attrs });
    },
    openImagePicker: () => {
      if (!mayStart()) return;
      if (pickerPosition.current) removeImagePosition(editor, pickerPosition.current);
      pickerPosition.current = reserveImagePosition(editor);
      input.current.click();
    },
    painterArmed: !!painterLook && !readOnly && !locked && !busy, applyPainter,
    togglePainter: () => {
      if (readOnly || locked || busy) return;
      if (!painterLook) setPainterLook(captureLook(editor.state));
      else if (editor.state.selection.empty) setPainterLook(null);
      else applyPainter();
    },
    saveLook: () => {
      if (readOnly || locked || busy) return;
      closeTray();
      const line = editor.state.selection.$from.parent;
      editor.view.focus();
      setStyleDraft({ look: captureLook(editor.state), block: line.type.name === "heading" ? `h${line.attrs.level}` : null,
        lineHeight: line.attrs.lineHeight ?? null });
    },
    runAction: (action) => {
      if (readOnly || locked || busy) return;
      if (action.tray) toggleTray(action.tray);
      else { closeTray(); action.run({ editor, ui: editorUi }); }
    },
  };
  if (!editor) return null;
  return <>
    <input ref={input} type="file" accept="image/*" multiple hidden aria-label="Add images" disabled={readOnly || locked || busy}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (mayStart() && files.length) inserter.current?.insert(files, pickerPosition.current ?? undefined);
        else if (pickerPosition.current) removeImagePosition(editor, pickerPosition.current);
        pickerPosition.current = null;
      }} />
    <div className="flex flex-1 flex-col" data-editor-surface onClick={(event) => {
      if (!event.target.closest(".ProseMirror, [data-selection-menu]")) editor.commands.focus("end");
    }}>
      <EditorContent editor={editor} className="flex-1" style={findSpace.current ? { paddingBottom: findSpace.current } : undefined} />
    </div>
    <div ref={dock} data-formatting-dock className="fixed inset-x-0 z-30" style={{ bottom: Math.max(0, window.innerHeight - viewport.height - viewport.top) }}>
      {openTray && !locked && !readOnly && <Tray name={openTray} {...trayOptions} viewportHeight={viewport.height} onClose={closeTray}
        editor={editor} formatting={formatting} ui={editorUi} />}
      {editorUi.painterArmed && <div className="border-t border-gray-200 bg-blue-50">
        <div role="status" className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-1 text-xs">
          <span className="flex-1">Format copied. Select text, then tap Apply format.</span>
          <ActionButton compact={false} label="Cancel" onAction={() => setPainterLook(null)}>Cancel</ActionButton>
        </div>
      </div>}
      {(adding > 0 || imageErrors.length > 0) && <div className="image-status mx-auto max-w-2xl border-t border-gray-200 bg-white px-3 py-2 text-sm">
        {adding > 0 && <p role="status">Adding image…</p>}
        {imageErrors.map((message, i) => <p role="alert" key={i}>{message}</p>)}
        {imageErrors.length > 0 && <button className="min-h-10 underline" onClick={() => setImageErrors([])}>Dismiss</button>}
      </div>}
      {find && <div data-find-bar className="border-t border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="mx-auto flex max-w-2xl items-center gap-1 px-3 py-1 text-xs">
          <span role="status" className="min-w-0 flex-1 break-words">{found.hidden ? "In folded lines" : found.count ? `${found.current + 1} of ${found.count}` : titleMatch ? "Found in the title" : found.hadMatches ? "No matches left" : "No matches in the text"} · "{find}"</span>
          {[["Previous match", ChevronUp, -1], ["Next match", ChevronDown, 1]].map(([label, Icon, direction]) => <button key={label} className="min-h-11 min-w-11" aria-label={label} disabled={!found.count || busy || locked}
            onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()}
            onClick={() => showMatch((found.current + direction + found.count) % found.count)}><Icon size={20} className="mx-auto" aria-hidden="true" /></button>)}
          <button className="min-h-11 min-w-11" aria-label="Close search" disabled={busy || locked}
            onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()}
            onClick={() => { imageJump.current = null; onClearFind?.(); }}><X size={20} className="mx-auto" aria-hidden="true" /></button>
        </div>
      </div>}
      <Toolbar editor={editor} ids={formatting?.toolbar ?? toolbarIds} layout={formatting?.toolbarLayout} formatting={formatting} readOnly={readOnly || locked || busy} ui={editorUi} />
    </div>
    {viewImage && <ImageViewer image={viewImage} onClose={() => setViewImage(null)} />}
    {styleDraft && <StyleEditor initial={styleDraft} formatting={formatting ?? resolveFormatting({})}
      {...{ busy, readOnly, run, refresh, error }} onClose={() => setStyleDraft(null)} />}
    <SelectionMenu editor={editor} ids={formatting?.selectionMenu} formatting={formatting} ui={editorUi} />
  </>;
}

export default function NoteEditor(props) {
  // A new note gets a fresh editor and undo history. Same-id save echoes never set content.
  return <NoteDocument key={props.note.id} {...props} />;
}
