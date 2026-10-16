import { useEditorState } from "@tiptap/react";
import { ACTIONS, DEFAULT_TOOLBAR } from "./actions.js";

export function ActionButtons({ editor, ids, ui = {}, size = 20 }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => Object.fromEntries(ids.map((id) => [id, editor ? ACTIONS[id]?.isActive?.(editor) ?? false : false])),
  });
  return ids.map((id, index) => {
    const action = ACTIONS[id];
    if (!action) return null;
    const Icon = action.icon;
    return (
      <button key={`${id}:${index}`} type="button" aria-label={action.label}
        aria-pressed={action.kind === "toggle" ? active?.[id] : undefined}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => action.run({ editor, ui })}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${active?.[id] ? "bg-blue-100 text-blue-700" : "text-gray-700 active:bg-gray-200"}`}>
        {id.startsWith("color:") ? <span className="block h-5 w-5 rounded-full border border-gray-300"
          style={{ background: action.color ?? "linear-gradient(135deg,#fff 45%,#999 50%,#fff 55%)" }} /> : <Icon size={size} />}
      </button>
    );
  });
}

export default function Toolbar({ editor, ids = DEFAULT_TOOLBAR, ui }) {
  return <div role="toolbar" aria-label="Formatting" className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 backdrop-blur">
    <div className="mx-auto flex max-w-2xl gap-0.5 overflow-x-auto px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
      <ActionButtons editor={editor} ids={ids} ui={ui} />
    </div>
  </div>;
}
