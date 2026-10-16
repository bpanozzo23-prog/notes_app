import { useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { extensions } from "./extensions.js";
import Toolbar from "./Toolbar.jsx";
import SelectionMenu from "./SelectionMenu.jsx";

function NoteDocument({ note, onChange, toolbarIds }) {
  const initialHtml = useRef(note.html);
  const editor = useEditor({
    extensions,
    content: initialHtml.current,
    editorProps: {
      attributes: {
        class: "px-4 pb-24 pt-2", "aria-label": "Note body",
        autocorrect: "on", autocapitalize: "sentences", spellcheck: "true",
      },
      // Routing note links belongs to 1c. Never hand a note: URL to the browser.
      handleClick: (_view, _pos, event) => {
        const href = event.target.closest?.("a[href]")?.getAttribute("href");
        if (/^note:/i.test(href ?? "")) { event.preventDefault(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  if (!editor) return null;
  return <>
    <div className="flex flex-1 flex-col" data-editor-surface onClick={(event) => {
      if (!event.target.closest(".ProseMirror")) editor.commands.focus("end");
    }}>
      <EditorContent editor={editor} className="flex-1" />
    </div>
    <Toolbar editor={editor} ids={toolbarIds} />
    <SelectionMenu editor={editor} />
  </>;
}

export default function NoteEditor(props) {
  // A new note gets a fresh editor and undo history. Same-id save echoes never set content.
  return <NoteDocument key={props.note.id} {...props} />;
}
