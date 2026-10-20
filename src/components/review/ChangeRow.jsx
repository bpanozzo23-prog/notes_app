import { useId, useState } from "react";
import { Image, Link } from "lucide-react";
import { htmlToText } from "../../lib/text.js";
import ReviewRow from "./ReviewRow.jsx";
import InlineDiff, { changedWordCount } from "./InlineDiff.jsx";
import ReadOnlyBody from "./ReadOnlyBody.jsx";
import { useOverlay } from "../../lib/overlays.jsx";

export { ReadOnlyBody };
export function effectLabel(effect, titles = new Map()) {
  const target = (href) => href?.startsWith("note:") ? titles.get(href.slice(5)) ?? "Missing or trashed note" : href;
  if (effect.type === "image-removed") return "Removes an image";
  if (effect.type === "image-added") return "Adds an image";
  if (effect.type === "link-retargeted") return `Link now points to ${target(effect.after)} (was ${target(effect.before)})`;
  if (effect.type === "link-removed") return `Removes a link to ${target(effect.href)}`;
  if (effect.type === "note-link-added") return `Adds a note link: ${target(effect.href)}`;
  return `Adds a web link: ${effect.href}`;
}

// The saved editor end-line travels with its block, but shouldn't add blank preview space.
const shown = (blocks) => {
  const list = [...blocks];
  while (list.length > 1 && list.at(-1) === "<p></p>") list.pop();
  return list.join("");
};

export default function ChangeRow({ change, checked, onToggle, disabled, titles }) {
  const [expanded, setExpanded] = useState(false), previewId = useId();
  useOverlay(expanded, () => setExpanded(false));
  const added = !change.before.length, removed = !change.after.length;
  const structural = change.formatting.some((label) => label.startsWith("now ") || label.startsWith("new heading"));
  const count = changedWordCount(change.words);
  const label = added ? "Added" : removed ? "Removed" : !structural && count ? `Text · ${count} ${count === 1 ? "word" : "words"}` : "Text";
  const before = shown(change.before), after = shown(change.after);
  const chips = !added && !removed ? change.formatting.map((label) => <span key={label} className="my-0.5 mr-1 inline-block rounded-full bg-[var(--color-kind-bg)] px-2.5 py-px text-[13px] text-[var(--color-kind-ink)]">{label}</span>) : [];
  return <ReviewRow label={label} checked={checked} onToggle={onToggle} disabled={disabled} chips={chips}>
    {added || removed ? <div className={`border-l-[3px] pl-2.5 ${added ? "border-[var(--color-ins-ink)]" : "border-[var(--color-del-ink)]"}`}><ReadOnlyBody html={added ? after : before} /></div>
      : structural ? <><ReadOnlyBody html={after} /><p className="my-1.5 border-l-[3px] border-[var(--color-line)] pl-2.5 text-[15px] text-[var(--color-muted)]">Before: {htmlToText(before).replace(/\s+/g, " ")}</p></>
        : <>
          {change.words.length ? <InlineDiff words={change.words} /> : <ReadOnlyBody html={after} />}
          <button type="button" className="min-h-11 pt-2 pb-1 text-left text-sm text-[var(--color-accent)]" aria-expanded={expanded} aria-controls={previewId} disabled={disabled} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide before and after" : "Show before and after"}</button>
          {expanded && <div id={previewId} className="space-y-2 py-1">
            <div className="rounded border border-[var(--color-line)] p-2"><h3 className="text-sm font-semibold text-[var(--color-muted)]">− Before</h3><ReadOnlyBody html={before} /></div>
            <div className="rounded border border-[var(--color-line)] p-2"><h3 className="text-sm font-semibold text-[var(--color-muted)]">+ After</h3><ReadOnlyBody html={after} /></div>
          </div>}
        </>}
    {change.effects.map((effect, index) => {
      const Icon = effect.type.startsWith("image-") ? Image : Link;
      return <p className="mt-1 flex items-start gap-1.5 text-sm text-[var(--color-muted)]" key={index}><Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" /><span>{effectLabel(effect, titles)}</span></p>;
    })}
  </ReviewRow>;
}
