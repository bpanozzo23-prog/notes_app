import ChangeRow from "./review/ChangeRow.jsx";
export { ReadOnlyBody, effectLabel } from "./review/ChangeRow.jsx";

// Tidy uses individual white cards; multi-note reviews can place ChangeRow directly in a card.
export default function ChangeCard({ index, total, ...props }) {
  return <article aria-label={`Change ${index} of ${total}`} className="my-2.5 rounded-xl border border-[var(--color-line)] bg-white px-3.5 py-1">
    <ChangeRow {...props} />
  </article>;
}
