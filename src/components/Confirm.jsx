import Dialog from "./Dialog.jsx";
import { useId } from "react";

export default function Confirm({ title, children, confirmLabel = "Confirm", onConfirm, onCancel, busy = false, error }) {
  const descriptionId = useId();
  return <Dialog title={title} onClose={onCancel} busy={busy} descriptionId={descriptionId}>
    <div id={descriptionId} className="break-words text-sm leading-relaxed">{children}</div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button data-initial-focus className="app-button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="app-button text-red-700" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </Dialog>;
}
