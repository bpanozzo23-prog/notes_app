import { useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { extensions } from "./extensions.js";
import Toolbar from "./Toolbar.jsx";
import SelectionMenu from "./SelectionMenu.jsx";

function NoteDocument({ note, onChange, toolbarIds, ui }) {
  const initialHtml = useRef(note.html);
  const editor = useEditor({
    extensions,
    content: initialHtml.current,
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
  if (!editor) return null;
  return <>
    <div className="flex flex-1 flex-col" data-editor-surface onClick={(event) => {
      if (!event.target.closest(".ProseMirror, [data-selection-menu]")) editor.commands.focus("end");
    }}>
      <EditorContent editor={editor} className="flex-1" />
    </div>
    <Toolbar editor={editor} ids={toolbarIds} ui={ui} />
    <SelectionMenu editor={editor} ui={ui} />
  </>;
}

export default function NoteEditor(props) {
  // A new note gets a fresh editor and undo history. Same-id save echoes never set content.
  return <NoteDocument key={props.note.id} {...props} />;
}
