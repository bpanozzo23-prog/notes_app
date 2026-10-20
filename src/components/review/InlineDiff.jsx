import { Fragment } from "react";

// Count a replacement once, rather than once removed and once added. Separate edits add up.
export function changedWordCount(parts) {
  let count = 0, removed = 0, added = 0;
  const flush = () => { count += Math.max(removed, added); removed = 0; added = 0; };
  for (const part of parts) {
    const words = part.value.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
    if (part.removed) removed += words;
    else if (part.added) added += words;
    else flush();
  }
  flush();
  return count;
}

export default function InlineDiff({ words }) {
  return <div className="whitespace-pre-wrap">{words.map((part, index) => part.removed
    ? <del className="review-removed" key={index}><span className="sr-only">removed: </span>{part.value}</del>
    : part.added
      ? <ins className="review-added" key={index}><span className="sr-only">added: </span>{part.value}</ins>
      : <Fragment key={index}>{part.value}</Fragment>)}</div>;
}
