import { useState } from "react";
import Dialog from "../../components/Dialog.jsx";
import Confirm from "../../components/Confirm.jsx";
import { EMPTY_LOOK, lookStyle } from "../../editor/look.js";
import { newId } from "../../lib/ids.js";
import { saveNamedStyle, deleteNamedStyle } from "../../db/styles.js";

export const deleteStyleMessage = (name) => `Delete the style “${name}”? Text already styled with it keeps its look.`;
const sizes = [10, 12, 14, 17, 20, 24, 28];

function Palette({ label, entries, value, onChange }) {
  const visible = entries.filter((entry) => !entry.hidden);
  if (value && !visible.some((entry) => entry.color === value)) visible.push({ color: value, name: value });
  return <fieldset className="min-w-0"><legend className="mb-1 text-sm font-medium">{label}</legend>
    <div className="flex flex-wrap gap-1">
      <button type="button" className="filter-chip" aria-pressed={value === null} onClick={() => onChange(null)}>None</button>
      {visible.map(({ color, name }) => <button key={color} type="button" className="icon-button" aria-label={name} title={name}
        aria-pressed={value === color} onClick={() => onChange(color)}>
        <span className="h-5 w-5 rounded-full border border-gray-300" style={{ backgroundColor: color }} />
      </button>)}
    </div>
  </fieldset>;
}

function Choice({ label, value, onChange, entries }) {
  return <label className="flex min-w-0 items-center justify-between gap-3 text-sm font-medium">{label}
    <select aria-label={label} className="app-input min-w-0 w-44" value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
      {entries.map(([value, name]) => <option key={value ?? ""} value={value ?? ""}>{name}</option>)}
    </select>
  </label>;
}

export default function StyleEditor({ style, initial, formatting, busy, readOnly, run, refresh, error, onClose }) {
  const [draft, setDraft] = useState(() => style ?? { id: newId(), name: "", look: { ...EMPTY_LOOK }, block: null, lineHeight: null, ...initial });
  const [originalToolbar] = useState(() => !!style && formatting.toolbar.includes(`style:${style.id}`));
  const [inToolbar, setInToolbar] = useState(originalToolbar);
  const [otherSize, setOtherSize] = useState(() => !!draft.look.fontSize && !sizes.includes(parseInt(draft.look.fontSize)));
  const [sizeText, setSizeText] = useState(() => draft.look.fontSize?.replace("pt", "") ?? "17");
  const [validation, setValidation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const disabled = busy || readOnly;
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const look = (patch) => setDraft((current) => ({ ...current, look: { ...current.look, ...patch } }));
  function chooseSize(fontSize) {
    setOtherSize(fontSize === "other");
    if (fontSize === "other") {
      const points = draft.look.fontSize?.replace("pt", "") ?? "17";
      setSizeText(points);
      look({ fontSize: `${points}pt` });
    } else look({ fontSize });
  }
  async function save() {
    if (disabled) return;
    if (!draft.name.trim() || draft.name.trim().length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(draft.name)) {
      setValidation("Enter a name of 1–40 characters."); return;
    }
    if (otherSize && (!/^\d+$/.test(sizeText) || Number(sizeText) < 6 || Number(sizeText) > 72)) {
      setValidation("Size must be a whole number from 6 to 72."); return;
    }
    setValidation("");
    const next = { ...draft, look: { ...draft.look, ...(otherSize ? { fontSize: `${Number(sizeText)}pt` } : {}) } };
    if (await run(async () => {
      await saveNamedStyle(next, { toolbarChanged: inToolbar !== originalToolbar, inToolbar });
      await refresh();
    })) onClose();
  }
  return <>
    <Dialog title={style ? "Edit style" : "New style"} sheet fullScreen busy={busy} onClose={onClose}
      footer={<div>
        {(validation || error) && <p role="alert" className="mb-2 text-sm text-red-700">{validation || error}</p>}
        <div className="flex items-center gap-2">
          {style && <button className="app-button danger" disabled={disabled} onClick={() => setDeleting(true)}>Delete</button>}
          <div className="flex-1" />
          <button className="app-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="app-button primary" disabled={disabled} onClick={save}>Save</button>
        </div>
      </div>}>
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        <label className="block text-sm font-medium">Name<input className="app-input mt-1 w-full" required maxLength={40} value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
        <div><p className="text-sm font-medium">Preview</p><p className="truncate py-2" style={lookStyle(draft.look)}>{draft.name.trim() || "Preview"}</p></div>
        <fieldset><legend className="mb-1 text-sm font-medium">Text</legend><div className="flex gap-1">
          {[["bold", "B", "Bold"], ["italic", "I", "Italic"], ["underline", "U", "Underline"], ["strike", "S", "Strikethrough"]].map(([key, text, label]) =>
            <button key={key} type="button" className="icon-button" aria-label={label} aria-pressed={draft.look[key]}
              style={lookStyle({ ...EMPTY_LOOK, [key]: true }, false)} onClick={() => look({ [key]: !draft.look[key] })}>{text}</button>)}
        </div></fieldset>
        <Palette label="Colour" entries={formatting.textColors} value={draft.look.color} onChange={(color) => look({ color })} />
        <Palette label="Highlight" entries={formatting.highlightColors} value={draft.look.highlight} onChange={(highlight) => look({ highlight })} />
        <Choice label="Size" value={otherSize ? "other" : draft.look.fontSize} entries={[[null, "Normal"], ...sizes.map((size) => [`${size}pt`, `${size} pt`]), ["other", "Other…"]]}
          onChange={chooseSize} />
        {otherSize && <label className="block text-sm">Other size (pt)<input className="app-input ml-2 w-24" type="number" min="6" max="72" step="1" inputMode="numeric" value={sizeText}
          onChange={(event) => { setSizeText(event.target.value); if (/^\d+$/.test(event.target.value) && Number(event.target.value) >= 6 && Number(event.target.value) <= 72) look({ fontSize: `${Number(event.target.value)}pt` }); }} /></label>}
        <Choice label="Typeface" value={draft.look.fontFamily} onChange={(fontFamily) => look({ fontFamily })}
          entries={[[null, "Default"], ["serif", "Serif"], ["sans-serif", "Sans-serif"], ["monospace", "Monospace"]]} />
        <Choice label="Spacing" value={draft.lineHeight} onChange={(lineHeight) => update({ lineHeight })}
          entries={[[null, "Default"], ...["1", "1.15", "1.5", "2"].map((value) => [value, value])]} />
        <Choice label="Line" value={draft.block} onChange={(block) => update({ block })}
          entries={[[null, "Leave as is"], ["paragraph", "Paragraph"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"]]} />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={inToolbar} onChange={(event) => setInToolbar(event.target.checked)} />Button in the toolbar</label>
      </fieldset>
    </Dialog>
    {deleting && <Confirm tone="danger" title="Delete style?" confirmLabel="Delete" busy={disabled} error={error} onCancel={() => setDeleting(false)}
      onConfirm={async () => { if (!disabled && await run(async () => { await deleteNamedStyle(style.id); await refresh(); })) onClose(); }}>
      {deleteStyleMessage(style.name)}
    </Confirm>}
  </>;
}
