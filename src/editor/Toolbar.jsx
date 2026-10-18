import { useEffect } from "react";
import { useEditorState } from "@tiptap/react";
import { Ellipsis } from "lucide-react";
import { resolveAction, DEFAULT_TOOLBAR } from "./actions.js";
import ActionButton, { ActionIcon } from "./ActionButton.jsx";
import { MORE_BUTTON, splitToolbar } from "./toolbarLayout.js";
import { useToolbarSize } from "./useToolbarSize.js";

export function ActionButtons({ editor, ids, formatting, ui = {}, size = 20, readOnly = false }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => Object.fromEntries(ids.map((id) => [id, editor ? resolveAction(id, formatting)?.isActive?.(editor) ?? false : false])),
  });
  return ids.map((id, index) => {
    const action = resolveAction(id, formatting);
    if (!action) return null;
    return <ActionButton key={`${id}:${index}`} label={action.label} disabled={readOnly}
      pressed={id === "painter" ? !!ui.painterArmed : action.kind === "toggle" ? !!active?.[id] : undefined}
      expanded={action.tray ? ui.openTray === action.tray : undefined}
      onAction={() => {
        if (!editor) return;
        if (ui.runAction) ui.runAction(action);
        else if (action.tray) ui.toggleTray?.(action.tray);
        else action.run({ editor, ui });
      }}><ActionIcon action={action} size={size} /></ActionButton>;
  });
}

export function ActionRows({ rows, more, source, editor, formatting, ui, readOnly, size }) {
  return rows.map((row, index) => <div className="action-row" key={index}>
    <ActionButtons editor={editor} ids={row.filter((id) => id !== MORE_BUTTON)} formatting={formatting} ui={ui} readOnly={readOnly} size={size} />
    {row.includes(MORE_BUTTON) && <ActionButton label="More" disabled={readOnly}
      expanded={ui?.openTray === "more" && ui?.traySource === source}
      onAction={() => { if (editor) ui?.toggleTray?.("more", { ids: more, source }); }}><Ellipsis size={22} aria-hidden="true" /></ActionButton>}
  </div>);
}

export default function Toolbar({ editor = null, ids = DEFAULT_TOOLBAR, layout = "scroll", formatting, ui, readOnly, onCapacity }) {
  const { ref, perRow } = useToolbarSize();
  const split = splitToolbar(ids.filter((id) => resolveAction(id, formatting)), perRow, layout);
  useEffect(() => { onCapacity?.(perRow); }, [perRow, onCapacity]);
  return <div role="toolbar" aria-label={editor ? "Formatting" : "Toolbar preview"} className="border-t border-gray-200 bg-white/95 backdrop-blur">
    <div ref={ref} className={`toolbar-inner mx-auto max-w-2xl px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] ${layout === "scroll" ? "overflow-x-auto" : ""}`}>
      <ActionRows {...split} source="toolbar" editor={editor} formatting={formatting} ui={ui} readOnly={readOnly || !editor} />
    </div>
  </div>;
}
