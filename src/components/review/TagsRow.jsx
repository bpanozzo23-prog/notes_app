import ReviewRow from "./ReviewRow.jsx";

export default function TagsRow({ added, removed, ...props }) {
  return <ReviewRow label="Tags" checkboxLabel={`Tags: ${[...added.map((tag) => `+ ${tag}`), ...removed.map((tag) => `− ${tag}`)].join(" ")}`} {...props}>
    {added.map((tag) => <span key={`add-${tag}`} className="my-0.5 mr-1 inline-block rounded-full bg-[var(--color-ins-bg)] px-2.5 py-px text-[15px] text-[var(--color-ins-ink)]">+ {tag}</span>)}
    {removed.map((tag) => <del key={`remove-${tag}`} className="my-0.5 mr-1 inline-block rounded-full bg-[var(--color-del-bg)] px-2.5 py-px text-[15px] text-[var(--color-del-ink)]"><span className="sr-only">removed: </span>{tag}</del>)}
  </ReviewRow>;
}
