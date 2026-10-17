import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState } from "@tiptap/react";
import { DEFAULT_SELECTION_MENU, resolveAction } from "./actions.js";
import { ActionRows } from "./Toolbar.jsx";
import ActionButton from "./ActionButton.jsx";
import { buttonsPerRow, splitToolbar } from "./toolbarLayout.js";
import { useVisibleViewport } from "./useToolbarSize.js";

export default function SelectionMenu({ editor, ids = DEFAULT_SELECTION_MENU, formatting, ui }) {
  const viewport = useVisibleViewport();
  const href = useEditorState({ editor, selector: ({ editor }) =>
    editor.state.selection.empty && editor.isActive("link") ? editor.getAttributes("link").href : null,
  });
  const internal = /^note:/i.test(href ?? "");
  const external = /^(https:|mailto:)/i.test(href ?? "");
  const perRow = buttonsPerRow(Math.min(viewport.width, 672) - 22);
  const known = ids.filter((id) => resolveAction(id, formatting));
  // Cursor-link commands get the first row; formatting can use the remaining row.
  const split = splitToolbar(known, perRow, href ? "more" : "rows");
  return <BubbleMenu editor={editor}
    shouldShow={({ editor, state, view, element }) => editor.isEditable && (known.length > 0 || editor.isActive("link")) &&
      (view.hasFocus() || element.contains(document.activeElement)) && (!state.selection.empty || editor.isActive("link"))}
    options={{ strategy: "fixed", placement: "bottom", offset: 12,
      flip: { rootBoundary: "viewport", padding: 8 },
      // This Tiptap version applies offset AFTER shift. Reserve its 12 px gap too,
      // otherwise a menu flipped to the top ends up at 8 - 12 = -4 px.
      shift: { rootBoundary: "viewport", padding: { top: 20, bottom: 20, left: 8, right: 8 }, crossAxis: true } }}
    data-selection-menu role="toolbar" aria-label="Selection formatting"
    style={{ maxWidth: viewport.width - 16 }}
    className="z-20 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-0.5 shadow-lg">
    {href && <div className="action-row mb-0.5">
      {(internal || external) && <ActionButton compact={false} label={internal ? "Open note" : "Open link"}
        onAction={() => internal ? ui?.openNote?.(href.slice(5)) : window.open(href, "_blank", "noopener")}>{internal ? "Open note" : "Open link"}</ActionButton>}
      <ActionButton compact={false} label="Remove link" onAction={() => ui?.removeLink?.(editor)}>Remove link</ActionButton>
    </div>}
    <ActionRows {...split} source="selection" editor={editor} formatting={formatting} ui={ui} size={18} />
  </BubbleMenu>;
}
