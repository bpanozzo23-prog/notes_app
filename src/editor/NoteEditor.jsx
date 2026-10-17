import { useContext, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { extensions } from "./extensions.js";
import Toolbar from "./Toolbar.jsx";
import SelectionMenu from "./SelectionMenu.jsx";
import Tray, { TRAYS } from "./Tray.jsx";
import { useVisibleViewport } from "./useToolbarSize.js";
import { useOverlay } from "../lib/overlays.jsx";
import { DialogLock } from "../components/Dialog.jsx";

function NoteDocument({ note, onChange, toolbarIds, formatting, readOnly = false, ui, onEditor }) {
  const [openTray, setOpenTray] = useState(null);
  const [trayOptions, setTrayOptions] = useState({});
  const viewport = useVisibleViewport();
  const locked = useContext(DialogLock);
  const closeTray = () => setOpenTray(null);
  useOverlay(!!openTray && !locked && !readOnly, closeTray);
  useEffect(() => { if (locked || readOnly) setOpenTray(null); }, [locked, readOnly]);
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
  function toggleTray(name, options = {}) {
    if (readOnly || locked || !TRAYS[name]) return;
    setOpenTray(openTray === name && trayOptions.source === options.source ? null : name);
    setTrayOptions(options);
  }
  const editorUi = { ...ui, openTray, traySource: trayOptions.source, toggleTray,
    runAction: (action) => {
      if (readOnly || locked) return;
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
    <div className="fixed inset-x-0 z-30" style={{ bottom: Math.max(0, window.innerHeight - viewport.height - viewport.top) }}>
      {openTray && !locked && !readOnly && <Tray name={openTray} {...trayOptions} viewportHeight={viewport.height} onClose={closeTray}
        editor={editor} formatting={formatting} ui={editorUi} />}
      <Toolbar editor={editor} ids={formatting?.toolbar ?? toolbarIds} layout={formatting?.toolbarLayout} formatting={formatting} readOnly={readOnly} ui={editorUi} />
    </div>
    <SelectionMenu editor={editor} ids={formatting?.selectionMenu} formatting={formatting} ui={editorUi} />
  </>;
}

export default function NoteEditor(props) {
  // A new note gets a fresh editor and undo history. Same-id save echoes never set content.
  return <NoteDocument key={props.note.id} {...props} />;
}
