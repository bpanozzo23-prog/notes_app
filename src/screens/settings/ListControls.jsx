import { ArrowUp, ArrowDown, EllipsisVertical } from "lucide-react";

export function moveEntry(entries, index, target) {
  const next = [...entries];
  next.splice(target, 0, next.splice(index, 1)[0]);
  return next;
}

export default function ListControls({ label, index, count, disabled, onMove, onOptions, children }) {
  return <div className="flex shrink-0">
    <button className="icon-button" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => onMove(index - 1)}><ArrowUp size={18} aria-hidden="true" /></button>
    <button className="icon-button" aria-label={`Move ${label} down`} disabled={disabled || index === count - 1} onClick={() => onMove(index + 1)}><ArrowDown size={18} aria-hidden="true" /></button>
    {children}
    <button className="icon-button" aria-label={`Options for ${label}`} disabled={disabled} onClick={onOptions}><EllipsisVertical size={18} aria-hidden="true" /></button>
  </div>;
}
