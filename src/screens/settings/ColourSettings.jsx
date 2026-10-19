import { useState } from "react";
import ScreenHeader from "../../components/ScreenHeader.jsx";
import Dialog from "../../components/Dialog.jsx";
import Confirm from "../../components/Confirm.jsx";
import { delPref, setPref } from "../../db/db.js";
import ListControls, { moveEntry } from "./ListControls.jsx";

function ColourSample({ color, highlight, children = "Text" }) {
  return <span className="inline-block shrink-0 rounded px-1 text-sm" style={highlight
    ? { backgroundColor: color, color: "#1f2328" } : { color }}>{children}</span>;
}

export default function ColourSettings({ formatting, busy, readOnly, onBack, run, refresh, error }) {
  const [preference, setPreference] = useState("textColors");
  const [adding, setAdding] = useState(false), [options, setOptions] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [name, setName] = useState(""), [color, setColor] = useState("#2563eb"), [duplicate, setDuplicate] = useState(false);
  const entries = formatting[preference], highlight = preference === "highlightColors";
  const selected = entries.find((entry) => entry.color === options);
  const selectedIndex = entries.indexOf(selected);
  const existing = entries.find((entry) => entry.color === color);
  const disabled = busy || readOnly;
  const validName = name.trim().length > 0 && name.trim().length <= 40 && !/[\u0000-\u001f\u007f-\u009f]/.test(name);
  async function change(next) {
    if (disabled) return false;
    return run(async () => { await setPref(preference, next); await refresh(); });
  }
  const show = (entry) => change(entries.map((item) => item.color === entry.color ? { ...item, hidden: !item.hidden } : item));
  async function add() {
    if (disabled || !validName) return;
    if (existing) { setDuplicate(true); return; }
    if (entries.length >= 60) return;
    if (await change([...entries, { color, name: name.trim(), hidden: false, custom: true }])) setAdding(false);
  }
  return <section>
    <ScreenHeader title="Colours" onBack={onBack} busy={busy} />
    <div className="px-4 pb-8">
      <div className="mb-4 flex gap-2" role="group" aria-label="Palette">
        {[["textColors", "Text"], ["highlightColors", "Highlight"]].map(([value, label]) =>
          <button key={value} className="filter-chip" aria-pressed={value === preference} disabled={busy}
            onClick={() => setPreference(value)}>{label}</button>)}
      </div>
      <ul aria-label={highlight ? "Highlight colours" : "Text colours"} className="divide-y divide-[var(--color-line)]">
        {entries.map((entry, index) => <li key={entry.color} className={`colour-row flex min-w-0 items-center gap-1 py-1 ${entry.hidden ? "opacity-60" : ""}`}>
          {highlight ? <ColourSample color={entry.color} highlight /> : <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border border-gray-300" style={{ background: entry.color }} />}
          <span className="min-w-0 flex-1 truncate text-sm" title={`${entry.name}${entry.hidden ? " (hidden)" : ""}`}>{entry.name}{entry.hidden ? " (hidden)" : ""}</span>
          <ListControls label={entry.name} index={index} count={entries.length} disabled={disabled}
            onMove={(target) => change(moveEntry(entries, index, target))} onOptions={() => setOptions(entry.color)}>
            <button className="min-h-10 w-12 text-sm" aria-label={`${entry.hidden ? "Show" : "Hide"} ${entry.name}`} disabled={disabled} onClick={() => show(entry)}>{entry.hidden ? "Show" : "Hide"}</button>
          </ListControls>
        </li>)}
      </ul>
      <div className="mt-4 flex gap-2">
        <button className="app-button" disabled={disabled || entries.length >= 60} onClick={() => { setName(""); setColor(highlight ? "#fde68a" : "#2563eb"); setDuplicate(false); setAdding(true); }}>+ Add a colour</button>
        <button className="app-button danger" disabled={disabled} onClick={() => setConfirmation("reset")}>Reset</button>
      </div>
      {entries.length >= 60 && <p className="mt-2 text-sm">Up to 60 colours fit in this palette.</p>}
    </div>
    {adding && <Dialog title="Add a colour" sheet busy={busy} onClose={() => setAdding(false)}
      footer={<div className="flex justify-end gap-2"><button className="app-button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button><button className="app-button primary" disabled={disabled || !validName} onClick={add}>Add colour</button></div>}>
      <fieldset disabled={disabled} className="space-y-3">
        <label className="block">Name<input className="app-input mt-1 w-full" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="flex items-center gap-3">Colour<input type="color" className="h-11 w-16" value={color} onChange={(event) => { setColor(event.target.value.toLowerCase()); setDuplicate(false); }} /></label>
        <p><ColourSample color={color} highlight={highlight}>Sample text</ColourSample></p>
        {duplicate && existing && <div role="status" className="text-sm"><p>That colour is already in the list</p>
          {existing.hidden && <button className="app-button mt-2" onClick={async () => { if (await show(existing)) setAdding(false); }}>Show {existing.name}</button>}
        </div>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </fieldset>
    </Dialog>}
    {selected && <Dialog title={selected.name} sheet busy={busy} onClose={() => setOptions(null)}>
      <div className="flex flex-col gap-2">
        <button className="app-button" disabled={disabled || selectedIndex === 0} onClick={async () => { if (await change(moveEntry(entries, selectedIndex, 0))) setOptions(null); }}>Move to top</button>
        <button className="app-button" disabled={disabled || selectedIndex === entries.length - 1} onClick={async () => { if (await change(moveEntry(entries, selectedIndex, entries.length - 1))) setOptions(null); }}>Move to bottom</button>
        {selected.custom && <button className="app-button danger" disabled={disabled} onClick={() => { setConfirmation(selected); setOptions(null); }}>Delete</button>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="app-button" disabled={busy} onClick={() => setOptions(null)}>Cancel</button>
      </div>
    </Dialog>}
    {confirmation && <Confirm tone="danger" title={confirmation === "reset" ? "Reset colours?" : "Delete colour?"} confirmLabel={confirmation === "reset" ? "Reset" : "Delete"}
      busy={disabled} error={error} onCancel={() => setConfirmation(null)} onConfirm={async () => {
        if (disabled) return;
        const success = confirmation === "reset" ? await run(async () => { await delPref(preference); await refresh(); })
          : await change(entries.filter((entry) => entry.color !== confirmation.color));
        if (success) setConfirmation(null);
      }}>
      {confirmation === "reset" ? `Restore the starter ${highlight ? "highlight" : "text"} colours and their order?` : `Delete ${confirmation.name} from this palette? Existing text and pinned buttons keep their colour.`}
    </Confirm>}
  </section>;
}
