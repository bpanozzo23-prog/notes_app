import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState } from "@tiptap/react";
import { DEFAULT_SELECTION_MENU } from "./actions.js";
import { ActionButtons } from "./Toolbar.jsx";

export default function SelectionMenu({ editor, ids = DEFAULT_SELECTION_MENU, formatting, ui }) {
  const href = useEditorState({ editor, selector: ({ editor }) =>
    editor.state.selection.empty && editor.isActive("link") ? editor.getAttributes("link").href : null,
  });
  const internal = /^note:/i.test(href ?? "");
  const external = /^(https:|mailto:)/i.test(href ?? "");
  return <BubbleMenu editor={editor}
    shouldShow={({ editor, state, view, element }) => editor.isEditable &&
      (view.hasFocus() || element.contains(document.activeElement)) && (!state.selection.empty || editor.isActive("link"))}
    options={{ placement: "bottom", offset: 12 }}
    data-selection-menu role="toolbar" aria-label="Selection formatting"
    className="flex max-w-[calc(100vw-1rem)] flex-wrap gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-lg">
    {href && <>
      {(internal || external) && <button type="button" className="min-h-11 rounded px-2 text-sm" onPointerDown={(event) => event.preventDefault()}
        onClick={() => internal ? ui?.openNote?.(href.slice(5)) : window.open(href, "_blank", "noopener")}>{internal ? "Open note" : "Open link"}</button>}
      <button type="button" className="min-h-11 rounded px-2 text-sm" onPointerDown={(event) => event.preventDefault()}
        onClick={() => ui?.removeLink?.(editor)}>Remove link</button>
    </>}
    <ActionButtons editor={editor} ids={ids} formatting={formatting} ui={ui} size={18} />
  </BubbleMenu>;
}
