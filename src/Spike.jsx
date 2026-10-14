import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Undo2,
  Redo2,
  Eraser,
} from "lucide-react";

// Throwaway editor to answer one question: does a Tiptap/ProseMirror editor behave with Samsung
// Keyboard and Gboard on the owner's phone? Nothing here is meant to survive into the real app
// except what the test teaches us (see docs/BRIEF.md, "Spike").

const STORAGE_KEY = "notes_app.spike.html";

const COLORS = [
  ["default", null],
  ["red", "#dc2626"],
  ["green", "#15803d"],
  ["blue", "#2563eb"],
  ["purple", "#7c3aed"],
];

const CHECKLIST = [
  "Type a sentence with predictive text on. Accept a suggestion. Let autocorrect fix a word.",
  "Swipe-type a few words.",
  "Press Enter three times, then Backspace back up.",
  "Double-tap a word, tap Bold in the pop-up, then keep typing after the word.",
  "Put the cursor mid-word, tap Bold on the toolbar, type more letters.",
  "Type `## ` then a heading. `- ` for a bullet. `[] ` for a checkbox. `---` for a divider.",
  "Select across two paragraphs and tap Highlight.",
  "Paste text from Samsung Notes and from Chrome.",
  "With the keyboard open: is the toolbar visible? Scroll the note. Rotate the phone.",
];

// Every button must (a) not steal focus from the editor, or the keyboard closes, and (b) build
// its command chain at tap time. A chain created during render holds a stale snapshot of the
// document; running it later is rejected, or worse, applied over newer text. That was the first
// spike's dead toolbar.
function ToolButton({ onClick, active, label, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-md " +
        (active ? "bg-blue-100 text-blue-700" : "text-gray-700 active:bg-gray-200")
      }
    >
      {children}
    </button>
  );
}

function ColorDot({ color, active, onClick }) {
  return (
    <button
      type="button"
      aria-label={color[0]}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        "flex h-10 w-8 shrink-0 items-center justify-center " + (active ? "rounded-md bg-gray-200" : "")
      }
    >
      <span
        className="block h-5 w-5 rounded-full border border-gray-300"
        style={{ background: color[1] ?? "linear-gradient(135deg,#fff 45%,#999 50%,#fff 55%)" }}
      />
    </button>
  );
}

export default function Spike() {
  const [showHtml, setShowHtml] = useState(false);
  const [events, setEvents] = useState([]);
  const eventsRef = useRef([]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextStyleKit,
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: (() => {
      try {
        return localStorage.getItem(STORAGE_KEY) || "";
      } catch {
        return "";
      }
    })(),
    editorProps: {
      attributes: {
        class: "px-4 pb-24 pt-2",
        // Hints for the Android keyboard. Chrome honours autocorrect/autocapitalize on
        // contenteditable; whether Samsung Keyboard does is one of the things being tested.
        autocorrect: "on",
        autocapitalize: "sentences",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor }) => {
      try {
        localStorage.setItem(STORAGE_KEY, editor.getHTML());
      } catch {
        /* storage unavailable: the spike still works, it just will not survive a reload */
      }
    },
  });

  // Tiptap v3 does not re-render on every transaction; subscribe to the bits the UI shows.
  const ui = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            underline: editor.isActive("underline"),
            strike: editor.isActive("strike"),
            highlight: editor.isActive("highlight"),
            h1: editor.isActive("heading", { level: 1 }),
            h2: editor.isActive("heading", { level: 2 }),
            bulletList: editor.isActive("bulletList"),
            orderedList: editor.isActive("orderedList"),
            taskList: editor.isActive("taskList"),
            blockquote: editor.isActive("blockquote"),
            color: editor.getAttributes("textStyle").color ?? null,
            html: showHtml ? editor.getHTML() : "",
          }
        : null,
  });

  // Record the last few input events so a misbehaviour can be described precisely. On Android
  // nearly all typing arrives as a composition, which is exactly what ProseMirror struggles with.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const push = (label) => {
      eventsRef.current = [...eventsRef.current.slice(-7), label];
      setEvents(eventsRef.current);
    };
    const onBeforeInput = (e) => push(`beforeinput:${e.inputType}`);
    const onCompStart = () => push("compositionstart");
    const onCompEnd = (e) => push(`compositionend:"${e.data ?? ""}"`);
    dom.addEventListener("beforeinput", onBeforeInput);
    dom.addEventListener("compositionstart", onCompStart);
    dom.addEventListener("compositionend", onCompEnd);
    return () => {
      dom.removeEventListener("beforeinput", onBeforeInput);
      dom.removeEventListener("compositionstart", onCompStart);
      dom.removeEventListener("compositionend", onCompEnd);
    };
  }, [editor]);

  if (!editor || !ui) return null;

  // Fresh chain per tap (see ToolButton).
  const run = (build) => build(editor.chain().focus()).run();

  const markButtons = (size) => (
    <>
      <ToolButton label="Bold" active={ui.bold} onClick={() => run((c) => c.toggleBold())}>
        <Bold size={size} />
      </ToolButton>
      <ToolButton label="Italic" active={ui.italic} onClick={() => run((c) => c.toggleItalic())}>
        <Italic size={size} />
      </ToolButton>
      <ToolButton label="Underline" active={ui.underline} onClick={() => run((c) => c.toggleUnderline())}>
        <Underline size={size} />
      </ToolButton>
      <ToolButton label="Highlight" active={ui.highlight} onClick={() => run((c) => c.toggleHighlight())}>
        <Highlighter size={size} />
      </ToolButton>
    </>
  );

  const colorButtons = (colors) =>
    colors.map((color) => (
      <ColorDot
        key={color[0]}
        color={color}
        active={ui.color === color[1]}
        onClick={() => run((c) => (color[1] ? c.setColor(color[1]) : c.unsetColor()))}
      />
    ));

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="px-4 pt-3 text-sm text-gray-600">
        <div className="flex items-center justify-between">
          <strong className="text-gray-900">Editor spike</strong>
          <div className="flex gap-3">
            <button type="button" className="underline" onClick={() => setShowHtml((v) => !v)}>
              {showHtml ? "hide html" : "show html"}
            </button>
            <button
              type="button"
              className="underline"
              onClick={() => {
                editor.commands.clearContent(true);
                try {
                  localStorage.removeItem(STORAGE_KEY);
                } catch {
                  /* ignore */
                }
              }}
            >
              clear
            </button>
          </div>
        </div>
        <details className="mt-1">
          <summary className="cursor-pointer">What to try</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13px]">
            {CHECKLIST.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </details>
      </header>

      <EditorContent editor={editor} className="flex-1" />

      {/* Pop-up when text is selected. Android's own Copy/Paste bar also appears, so this one
          is kept small and placed with a gap. */}
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor, state }) => editor.isEditable && !state.selection.empty}
        options={{ placement: "bottom", offset: 12 }}
        className="flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-lg"
      >
        {markButtons(18)}
        {colorButtons(COLORS.slice(1, 4))}
      </BubbleMenu>

      {showHtml && (
        <pre className="mx-4 mb-24 max-h-48 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px] whitespace-pre-wrap">
          {ui.html}
        </pre>
      )}

      {/* Bottom toolbar: fixed, so with interactive-widget=resizes-content it rides above the
          keyboard. Scrolls sideways when it does not fit. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 backdrop-blur">
        {events.length > 0 && (
          <div className="truncate px-2 pt-1 font-mono text-[10px] text-gray-500">
            {events.join(" · ")}
          </div>
        )}
        <div className="flex gap-0.5 overflow-x-auto px-2 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          {markButtons(20)}
          <ToolButton label="Strikethrough" active={ui.strike} onClick={() => run((c) => c.toggleStrike())}>
            <Strikethrough size={20} />
          </ToolButton>
          {colorButtons(COLORS)}
          <ToolButton
            label="Heading 1"
            active={ui.h1}
            onClick={() => run((c) => c.toggleHeading({ level: 1 }))}
          >
            <Heading1 size={20} />
          </ToolButton>
          <ToolButton
            label="Heading 2"
            active={ui.h2}
            onClick={() => run((c) => c.toggleHeading({ level: 2 }))}
          >
            <Heading2 size={20} />
          </ToolButton>
          <ToolButton label="Bullet list" active={ui.bulletList} onClick={() => run((c) => c.toggleBulletList())}>
            <List size={20} />
          </ToolButton>
          <ToolButton
            label="Numbered list"
            active={ui.orderedList}
            onClick={() => run((c) => c.toggleOrderedList())}
          >
            <ListOrdered size={20} />
          </ToolButton>
          <ToolButton label="Checklist" active={ui.taskList} onClick={() => run((c) => c.toggleTaskList())}>
            <ListChecks size={20} />
          </ToolButton>
          <ToolButton label="Quote" active={ui.blockquote} onClick={() => run((c) => c.toggleBlockquote())}>
            <Quote size={20} />
          </ToolButton>
          <ToolButton label="Divider" onClick={() => run((c) => c.setHorizontalRule())}>
            <Minus size={20} />
          </ToolButton>
          <ToolButton label="Clear formatting" onClick={() => run((c) => c.unsetAllMarks().clearNodes())}>
            <Eraser size={20} />
          </ToolButton>
          <ToolButton label="Undo" onClick={() => run((c) => c.undo())}>
            <Undo2 size={20} />
          </ToolButton>
          <ToolButton label="Redo" onClick={() => run((c) => c.redo())}>
            <Redo2 size={20} />
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
