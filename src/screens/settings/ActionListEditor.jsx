import { Fragment, useState } from "react";
import ListControls, { moveEntry } from "./ListControls.jsx";
import { availableActions, resolveAction } from "../../editor/actions.js";
import { ActionIcon } from "../../editor/ActionButton.jsx";
import { splitToolbar } from "../../editor/toolbarLayout.js";
import { db, setPref, writeTransaction } from "../../db/db.js";
import Dialog from "../../components/Dialog.jsx";
import Confirm from "../../components/Confirm.jsx";

export default function ActionListEditor({ preference, formatting, perRow, run, refresh, busy, readOnly, error }) {
  const [adding, setAdding] = useState(false);
  const [options, setOptions] = useState(null);
  const [reset, setReset] = useState(false);
  const toolbar = preference === "toolbar";
  const ids = formatting[preference];
  const entries = ids.map((id, index) => ({ id, index, action: resolveAction(id, formatting) }));
  const known = entries.filter((entry) => entry.action);
  const split = splitToolbar(known.map((entry) => entry.id), perRow, toolbar ? formatting.toolbarLayout : "rows");
  const overflowIndex = split.more.length ? known[known.length - split.more.length].index : -1;
  const disabled = busy || readOnly;
  const limit = toolbar ? 100 : 40;
  const groups = Map.groupBy(availableActions(formatting), (action) => action.group);
  const selected = options === null ? null : entries[options];

  async function change(next) {
    if (readOnly || busy) return false;
    return run(async () => { await setPref(preference, next); await refresh(); });
  }
  function move(index, target) {
    return change(moveEntry(ids, index, target));
  }
  async function resetDefaults() {
    if (readOnly || busy) return;
    if (await run(async () => {
      // Both toolbar keys disappear together, including if storage or the write guard fails.
      await writeTransaction([db.prefs], () => db.prefs.bulkDelete(toolbar ? ["toolbar", "toolbarLayout"] : ["selectionMenu"]));
      await refresh();
    })) setReset(false);
  }
  return <>
    <h2 className="mb-2 font-semibold">{toolbar ? "In your toolbar" : "In your selection pop-up"}</h2>
    {!ids.length && <p className="py-4 text-sm text-[var(--color-muted)]">{toolbar ? "Your toolbar is empty. Add buttons below." : "Your selection pop-up is empty. Add buttons below."}</p>}
    <ul aria-label={toolbar ? "Toolbar buttons" : "Selection pop-up buttons"} className="divide-y divide-[var(--color-line)]">
      {entries.map(({ id, index, action }) => <Fragment key={`${id}:${index}`}>
        {toolbar && index === overflowIndex && <li className="border-t-2 border-[var(--color-muted)] py-2 text-xs text-[var(--color-muted)]">Below this line: in ⋯ More</li>}
        <li className="flex min-w-0 items-center gap-2 py-1">
          {action && <span className="flex w-6 shrink-0 justify-center"><ActionIcon action={action} size={18} /></span>}
          <span className="min-w-0 flex-1 truncate text-sm" title={action?.label}>{action?.label ?? "Unavailable button"}</span>
          {action ? <ListControls label={action.label} index={index} count={ids.length} disabled={disabled}
            onMove={(target) => move(index, target)} onOptions={() => setOptions(index)} /> : <button className="app-button text-sm" disabled={disabled} onClick={() => change(ids.filter((_, i) => i !== index))}>Remove</button>}
        </li>
      </Fragment>)}
    </ul>
    {!toolbar && known.length > perRow && <p className="mt-2 text-sm text-amber-800">These buttons take more than one row. After two rows, the rest are in ⋯ More.</p>}
    <div className="mt-4 flex gap-2">
      <button className="app-button" disabled={disabled} onClick={() => setAdding(true)}>+ Add buttons</button>
      <button className="app-button" disabled={disabled} onClick={() => setReset(true)}>Reset</button>
    </div>
    {adding && <Dialog title="Add buttons" sheet busy={busy} onClose={() => setAdding(false)}
      footer={<button className="app-button w-full" disabled={busy} onClick={() => setAdding(false)}>Done</button>}>
      <fieldset disabled={disabled} className="min-w-0">
        {[...groups].map(([group, actions]) => <section key={group} className="mb-4">
          <h3 className="mb-1 font-semibold" tabIndex={group === "Text" ? -1 : undefined} data-initial-focus={group === "Text" ? "" : undefined}>{group}</h3>
          {actions.map((action) => {
            const added = known.some((entry) => entry.action.id === action.id);
            return <div key={action.id} className="flex min-w-0 items-center gap-2 py-1">
              <span className="flex w-6 shrink-0 justify-center"><ActionIcon action={action} size={18} /></span>
              <span className="min-w-0 flex-1 truncate text-sm" title={action.label}>{action.label}</span>
              <button className="app-button shrink-0 text-sm" aria-label={`${added ? "Added" : "Add"} ${action.label}`} disabled={disabled || added || ids.length >= limit}
                onClick={() => change([...ids, action.id])}>{added ? "Added" : "Add"}</button>
            </div>;
          })}
        </section>)}
      </fieldset>
      {ids.length >= limit && <p className="mb-2 text-sm">Up to {limit} buttons fit in this list. Remove one to add another.</p>}
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
    </Dialog>}
    {selected?.action && <Dialog title={selected.action.label} sheet busy={busy} onClose={() => setOptions(null)}>
      <div className="flex flex-col gap-2">
        <button className="app-button" disabled={disabled || options === 0} onClick={async () => { if (await move(options, 0)) setOptions(null); }}>Move to top</button>
        <button className="app-button" disabled={disabled || options === ids.length - 1} onClick={async () => { if (await move(options, ids.length - 1)) setOptions(null); }}>Move to bottom</button>
        <button className="app-button text-red-700" disabled={disabled} onClick={async () => { if (await change(ids.filter((_, i) => i !== options))) setOptions(null); }}>Remove</button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="app-button" disabled={busy} onClick={() => setOptions(null)}>Cancel</button>
      </div>
    </Dialog>}
    {reset && <Confirm title={toolbar ? "Reset toolbar?" : "Reset selection pop-up?"} confirmLabel="Reset" busy={busy} error={error}
      onCancel={() => setReset(false)} onConfirm={resetDefaults}>
      {toolbar ? "Reset the toolbar to the default buttons and layout?" : "Reset the selection pop-up to the default buttons?"}
    </Confirm>}
  </>;
}
