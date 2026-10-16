import { BubbleMenu } from "@tiptap/react/menus";
import { DEFAULT_SELECTION_MENU } from "./actions.js";
import { ActionButtons } from "./Toolbar.jsx";

export default function SelectionMenu({ editor, ids = DEFAULT_SELECTION_MENU, ui }) {
  return <BubbleMenu editor={editor}
    shouldShow={({ editor, state }) => editor.isEditable && !state.selection.empty}
    options={{ placement: "bottom", offset: 12 }}
    className="flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-lg">
    <ActionButtons editor={editor} ids={ids} ui={ui} size={18} />
  </BubbleMenu>;
}
