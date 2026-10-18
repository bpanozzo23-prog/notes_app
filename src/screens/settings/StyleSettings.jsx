import { useState } from "react";
import ScreenHeader from "../../components/ScreenHeader.jsx";
import Dialog from "../../components/Dialog.jsx";
import Confirm from "../../components/Confirm.jsx";
import ListControls, { moveEntry } from "./ListControls.jsx";
import StyleEditor, { deleteStyleMessage } from "./StyleEditor.jsx";
import { lookStyle } from "../../editor/look.js";
import { setPref } from "../../db/db.js";
import { deleteNamedStyle, resetNamedStyles } from "../../db/styles.js";

export default function StyleSettings({ formatting, busy, readOnly, onBack, run, refresh, error }) {
  const [editing, setEditing] = useState(null), [options, setOptions] = useState(null), [deleting, setDeleting] = useState(null);
  const [reset, setReset] = useState(false);
  const entries = formatting.namedStyles;
  const selected = entries.find((entry) => entry.id === options), index = entries.indexOf(selected);
  const disabled = busy || readOnly;
  async function move(from, to) {
    if (disabled) return false;
    return run(async () => { await setPref("namedStyles", moveEntry(entries, from, to)); await refresh(); });
  }
  return <section>
    <ScreenHeader title="Named styles" onBack={onBack} busy={busy} />
    <div className="px-4 pb-8">
      {!entries.length && <p className="py-4 text-sm">No named styles yet.</p>}
      <ul aria-label="Named styles" className="divide-y divide-[var(--color-line)]">
        {entries.map((style, index) => <li key={style.id} className="flex min-w-0 items-center gap-1 py-1">
          <button className="min-h-10 min-w-0 flex-1 truncate text-left" title={style.name} style={lookStyle(style.look)} disabled={disabled}
            onClick={() => setEditing(style)}>{style.name}</button>
          <ListControls label={style.name} index={index} count={entries.length} disabled={disabled} onMove={(target) => move(index, target)} onOptions={() => setOptions(style.id)} />
        </li>)}
      </ul>
      <div className="mt-4 flex gap-2">
        <button className="app-button" disabled={disabled || entries.length >= 50} onClick={() => setEditing({})}>+ New style</button>
        <button className="app-button" disabled={disabled} onClick={() => setReset(true)}>Reset</button>
      </div>
      {entries.length >= 50 && <p className="mt-2 text-sm">Up to 50 styles can be saved.</p>}
    </div>
    {editing && <StyleEditor style={editing.id ? editing : undefined} {...{ formatting, busy, readOnly, run, refresh, error }} onClose={() => setEditing(null)} />}
    {reset && <Confirm title="Reset named styles?" confirmLabel="Reset" busy={disabled} error={error} onCancel={() => setReset(false)}
      onConfirm={async () => { if (!disabled && await run(async () => { await resetNamedStyles(); await refresh(); })) setReset(false); }}>
      Reset named styles to the default? Text already styled keeps its look.
    </Confirm>}
    {selected && <Dialog title={selected.name} sheet busy={busy} onClose={() => setOptions(null)}>
      <div className="flex flex-col gap-2">
        <button className="app-button" disabled={disabled} onClick={() => { setEditing(selected); setOptions(null); }}>Edit</button>
        <button className="app-button" disabled={disabled || index === 0} onClick={async () => { if (await move(index, 0)) setOptions(null); }}>Move to top</button>
        <button className="app-button" disabled={disabled || index === entries.length - 1} onClick={async () => { if (await move(index, entries.length - 1)) setOptions(null); }}>Move to bottom</button>
        <button className="app-button text-red-700" disabled={disabled} onClick={() => { setDeleting(selected); setOptions(null); }}>Delete</button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="app-button" disabled={busy} onClick={() => setOptions(null)}>Cancel</button>
      </div>
    </Dialog>}
    {deleting && <Confirm title="Delete style?" confirmLabel="Delete" busy={disabled} error={error} onCancel={() => setDeleting(null)}
      onConfirm={async () => { if (!disabled && await run(async () => { await deleteNamedStyle(deleting.id); await refresh(); })) setDeleting(null); }}>
      {deleteStyleMessage(deleting.name)}
    </Confirm>}
  </section>;
}
