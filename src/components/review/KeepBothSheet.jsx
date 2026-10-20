import Dialog from "../Dialog.jsx";
import { NewNotePreview } from "./NewNoteRow.jsx";

export default function KeepBothSheet({ model, busy, onAdd, onClose }) {
  return <Dialog title="Keep both" sheet busy={busy} onClose={onClose} footer={<div className="flex flex-wrap gap-2">
    <button className="app-button primary" disabled={busy} onClick={onAdd}>Add as a new note</button>
    <button className="app-button" disabled={busy} onClick={onClose}>Cancel</button>
  </div>}>
    <NewNotePreview model={model} titles={model.titles} />
    {!!model.audit.length && <p className="my-2 rounded-[10px] bg-[var(--color-warn-bg)] px-3 py-2.5 text-[15px] text-[var(--color-warn-ink)]">Removed by the editor: {model.audit.join("; ")}.</p>}
  </Dialog>;
}
