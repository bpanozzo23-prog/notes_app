import { lookStyle } from "./look.js";
import { X } from "lucide-react";
import { useEditorState } from "@tiptap/react";
import ActionButton, { ActionIcon } from "./ActionButton.jsx";
import { ActionButtons } from "./Toolbar.jsx";
import { resolveAction } from "./actions.js";
import { resolveFormatting } from "./formatting.js";
import { LINE_SPACINGS } from "./nodes/LineSpacing.js";
import { CALLOUT_TYPES } from "./nodes/Callout.js";
import { DIVIDER_STYLES } from "./nodes/Divider.js";

function MoreTray({ ids, ...props }) {
  return <div className="flex flex-wrap gap-0.5"><ActionButtons ids={ids} {...props} /></div>;
}

function StylesTray({ formatting = resolveFormatting({}), ui }) {
  return <div className="flex min-w-0 flex-col gap-1">
    {formatting.namedStyles.map((style) => <ActionButton key={style.id} compact={false} label={style.name}
      onAction={() => ui.runAction(resolveAction(`style:${style.id}`, formatting))}>
      <span className="block truncate text-left" style={lookStyle(style.look)}>{style.name}</span>
    </ActionButton>)}
    {!formatting.namedStyles.length && <p className="px-2 text-sm">No named styles yet.</p>}
    <ActionButton compact={false} label="Save this look as a style…" onAction={ui.saveLook}>Save this look as a style…</ActionButton>
  </div>;
}

const option = (id, label, command, isActive, previewStyle) => ({
  id, label, kind: "toggle", isActive, previewStyle,
  run: ({ editor }) => command(editor.chain().focus()).run(),
});

export function trayOptions(name, editor, formatting = resolveFormatting({})) {
  if (["textColor", "highlightColor"].includes(name)) {
    const text = name === "textColor", prefix = text ? "color" : "highlight";
    const colors = formatting[text ? "textColors" : "highlightColors"].filter((entry) => !entry.hidden);
    return [...colors.map(({ color }) => resolveAction(`${prefix}:${color}`, formatting)),
      { ...resolveAction(`${prefix}:none`, formatting), label: text ? "No colour" : "No highlight" }];
  }
  if (name === "fontSize") return [null, 10, 12, 14, 17, 20, 24, 28].map((size) => option(
    `size:${size}`, size ? `${size} pt` : "Normal",
    (chain) => size ? chain.setFontSize(`${size}pt`) : chain.unsetFontSize(),
    (editor) => (editor.getAttributes("textStyle").fontSize ?? null) === (size ? `${size}pt` : null),
    { fontSize: size ? `${Math.min(size, 20)}pt` : undefined },
  ));
  if (name === "fontFamily") return [[null, "Default"], ["serif", "Serif"], ["sans-serif", "Sans-serif"], ["monospace", "Monospace"]].map(([family, label]) => option(
    `family:${family}`, label, (chain) => family ? chain.setFontFamily(family) : chain.unsetFontFamily(),
    (editor) => (editor.getAttributes("textStyle").fontFamily ?? null) === family, { fontFamily: family ?? undefined },
  ));
  if (name === "heading") return [[0, "Normal text"], [1, "Heading 1"], [2, "Heading 2"], [3, "Heading 3"]].map(([level, label]) => option(
    `heading:${level}`, label, (chain) => level ? chain.setHeading({ level }) : chain.setParagraph(),
    (editor) => level ? editor.isActive("heading", { level }) : editor.isActive("paragraph"),
    level ? { fontSize: ["1.35em", "1.2em", "1.05em"][level - 1], fontWeight: 700 } : undefined,
  ));
  if (name === "lineHeight") return [null, ...LINE_SPACINGS].map((value) => option(
    `spacing:${value}`, value ?? "Default", (chain) => value ? chain.setLineSpacing(value) : chain.unsetLineSpacing(),
    (editor) => editor.isActive("paragraph", { lineHeight: value }) || editor.isActive("heading", { lineHeight: value }),
  ));
  if (name === "callout") return [
    ...CALLOUT_TYPES.map((type) => resolveAction(`callout:${type}`, formatting)),
    ...(editor.isActive("callout") ? [option("callout:none", "Remove callout", (chain) => chain.unsetCallout(), () => false)] : []),
  ];
  if (name === "divider") return DIVIDER_STYLES.map((style) => ({
    ...resolveAction(style === "thin" ? "hr" : `hr:${style}`, formatting),
    label: `${style[0].toUpperCase() + style.slice(1)} divider`, dividerStyle: style,
    isActive: (editor) => editor.isActive("horizontalRule", { dividerStyle: style }),
  }));
  return [];
}

function PickerTray({ name, editor, formatting, ui }) {
  const options = trayOptions(name, editor, formatting);
  const active = useEditorState({ editor, selector: ({ editor }) => options.map((option) => option.isActive?.(editor) ?? false) });
  return <div className="flex flex-wrap gap-1">
    {options.map((option, index) => <ActionButton key={option.id} compact={false} label={option.label}
      pressed={active?.[index]} onAction={() => ui.runAction(option)}>
      <span className="flex items-center gap-2" style={option.previewStyle}>
        {option.icon && <ActionIcon action={option} size={18} />}{option.label}
      </span>
    </ActionButton>)}
  </div>;
}

export const TRAYS = Object.freeze(Object.assign(Object.create(null), {
  more: { label: "More", render: MoreTray },
  styles: { label: "Named styles", render: StylesTray },
  ...Object.fromEntries([["textColor", "Text colour"], ["highlightColor", "Highlight colour"], ["fontSize", "Font size"],
    ["fontFamily", "Typeface"], ["heading", "Heading"], ["lineHeight", "Line spacing"], ["callout", "Callout"], ["divider", "Divider styles"]]
    .map(([name, label]) => [name, { label, render: PickerTray }])),
}));

export default function Tray({ name, viewportHeight, onClose, ...props }) {
  const tray = TRAYS[name];
  if (!tray) return null;
  const Contents = tray.render;
  return <section aria-label={`${tray.label} tray`} className="mx-auto max-w-2xl overflow-y-auto border-t border-gray-200 bg-white p-2 shadow-lg"
    style={{ maxHeight: viewportHeight * 0.4 }}>
    <div className="flex items-center justify-between">
      <h2 className="px-2 text-sm font-semibold">{tray.label}</h2>
      <ActionButton label="Close tray" onAction={onClose}><X size={18} aria-hidden="true" /></ActionButton>
    </div>
    <Contents name={name} {...props} />
  </section>;
}
