import { linksItemIds } from "../claude/links.js";
import NoteReviewCard from "./review/NoteReviewCard.jsx";
import ReviewRow from "./review/ReviewRow.jsx";

export default function LinksCard({ source, links, notes, selected, toggle, selectRows, disabled }) {
  const ids = linksItemIds({ links }), anyTicked = ids.some((id) => selected.has(id));
  const selectionLabel = anyTicked ? "Untick all" : "Tick all";
  return <NoteReviewCard title={source.displayTitle}
    action={{ label: selectionLabel, ariaLabel: `${selectionLabel} in ${source.displayTitle}`, tone: "accent", disabled, onClick: () => selectRows(ids, !anyTicked) }}>
    <div>{links.map((link) => {
      const id = `${link.from}>${link.to}`, placement = link.placement;
      const target = notes.find((note) => note.handle === link.to).displayTitle;
      return <ReviewRow key={id} label="Link" checkboxLabel={`→ ${target}`} checked={selected.has(id)} disabled={disabled} onToggle={() => toggle(id)} reason={link.reason}>
        <p>→ {target}</p>
        {placement.kind === "inline" ? <p className="text-sm">Links the words "{placement.match}" in: {placement.before}<strong>{placement.match}</strong>{placement.after}</p>
          : <p className="text-sm">Adds it to "See also:" at the end of the note</p>}
      </ReviewRow>;
    })}</div>
  </NoteReviewCard>;
}
