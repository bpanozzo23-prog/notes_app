import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { extensions } from "./extensions.js";
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

function NoteDocument({ note, onChange, toolbarIds, formatting, readOnly = false, busy = false, run, refresh, error, ui, onEditor }) {
  const [painterLook, setPainterLook] = useState(null);
  const [styleDraft, setStyleDraft] = useState(null);
  const [openTray, setOpenTray] = useState(null);
  const [trayOptions, setTrayOptions] = useState({});
  const viewport = useVisibleViewport();
  const dock = useRef(null);
  const [dockHeight, setDockHeight] = useState(0);
  const locked = useContext(DialogLock);
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
      // Internal links use the guarded app navigation, never the browser's URL handler.
      handleClick: (_view, _pos, event) => {
        const href = event.target.closest?.("a[href]")?.getAttribute("href");
        if (/^note:/i.test(href ?? "")) { event.preventDefault(); ui?.openNote?.(href.slice(5)); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  useEffect(() => { onEditor?.(editor); return () => onEditor?.(null); }, [editor, onEditor]);
  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);
  useLayoutEffect(() => {
    if (!editor || !dock.current) return;
    const measure = () => setDockHeight(dock.current.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(dock.current);
    return () => observer?.disconnect();
  }, [editor, openTray, painterLook, viewport.height, formatting?.toolbarLayout]);
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
    <div className="flex flex-1 flex-col" data-editor-surface onClick={(event) => {
      if (!event.target.closest(".ProseMirror, [data-selection-menu]")) editor.commands.focus("end");
    }}>
      <EditorContent editor={editor} className="flex-1" />
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
      <Toolbar editor={editor} ids={formatting?.toolbar ?? toolbarIds} layout={formatting?.toolbarLayout} formatting={formatting} readOnly={readOnly || locked || busy} ui={editorUi} />
    </div>
    {styleDraft && <StyleEditor initial={styleDraft} formatting={formatting ?? resolveFormatting({})}
      {...{ busy, readOnly, run, refresh, error }} onClose={() => setStyleDraft(null)} />}
    <SelectionMenu editor={editor} ids={formatting?.selectionMenu} formatting={formatting} ui={editorUi} />
  </>;
}

export default function NoteEditor(props) {
  // A new note gets a fresh editor and undo history. Same-id save echoes never set content.
  return <NoteDocument key={props.note.id} {...props} />;
}
