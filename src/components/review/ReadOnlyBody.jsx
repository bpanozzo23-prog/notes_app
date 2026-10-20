import { useEditor, EditorContent } from "@tiptap/react";
import { extensions } from "../../editor/extensions.js";
import { parseBody } from "../../claude/html.js";

export default function ReadOnlyBody({ html }) {
  const editor = useEditor({ extensions, content: parseBody(html || "<p></p>"), editable: false,
    editorProps: { attributes: { "aria-label": "Proposal preview", tabindex: "-1" },
      handleDOMEvents: { click: (_view, event) => { event.preventDefault(); return true; } },
    },
  }, [html]);
  return <div className="claude-preview" onClickCapture={(event) => event.preventDefault()} onAuxClickCapture={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()}><EditorContent editor={editor} /></div>;
}
