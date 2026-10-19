import { useState } from "react";
import { X } from "lucide-react";
import { normalize } from "../lib/text.js";

export default function TagInput({ tags, allTags, onChange, suggestionsOpen = false, initialFocus = false }) {
  const [draft, setDraft] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(suggestionsOpen);
  const suggestions = allTags.filter((tag) => !tags.includes(tag) && normalize(tag).includes(normalize(draft.trim())));
  function add(value) {
    const additions = value.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (additions.length) onChange([...new Set([...tags, ...additions])]);
    setDraft("");
    setShowSuggestions(suggestionsOpen);
  }
  return <div className="min-w-0 text-sm">
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => <span key={tag} className="tag-chip max-w-full pl-3">
        <span className="break-all">{tag}</span><button className="icon-button h-11 w-9 shrink-0" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((value) => value !== tag))}>
          <X size={14} aria-hidden="true" />
        </button>
      </span>)}
      {/* The field and its Add button wrap together, so Add never lands alone on a new line. */}
      <span className="flex min-w-40 flex-1 items-center gap-1">
      <input aria-label="Add tag" placeholder="Add tag" data-initial-focus={initialFocus || undefined} className="min-h-11 min-w-0 flex-1 rounded border border-[var(--color-line)] bg-transparent px-2"
        value={draft} onChange={(event) => {
          const value = event.target.value;
          // Some phone keyboards insert a comma without a keydown event.
          if (value.includes(",")) add(value); else setDraft(value);
        }} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(draft); }
        }} />
      <button className="min-h-11 shrink-0 px-2 text-[var(--color-accent)]" disabled={!draft.trim()} onClick={() => add(draft)}>Add</button>
      </span>
    </div>
    {!!suggestions.length && <div className="mt-1">
      <button className="min-h-11 text-xs text-[var(--color-muted)]" aria-expanded={!!draft.trim() || showSuggestions}
        onClick={() => setShowSuggestions(!showSuggestions)}>Used before ({suggestions.length})</button>
      {(draft.trim() || showSuggestions) && <div role="group" aria-label="Tag suggestions" className="flex gap-2 overflow-x-auto pb-1">
        {suggestions.map((tag) => <button className="filter-chip" key={tag} onClick={() => add(tag)}>{tag}</button>)}
      </div>}
    </div>}
  </div>;
}
