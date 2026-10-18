import { linksItemIds } from "../claude/links.js";

export default function LinksCard({ source, links, notes, selected, toggle, untick, disabled }) {
  return <article aria-label={source.displayTitle} className="space-y-2 break-words rounded-lg border border-[var(--color-line)] p-3">
    <h2 className="text-lg font-semibold">{source.displayTitle}</h2>
    {links.map((link) => {
      const id = `${link.from}>${link.to}`, placement = link.placement;
      return <div key={id} className="space-y-1">
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={selected.has(id)} disabled={disabled} onChange={() => toggle(id)} /><span>→ {notes.find((note) => note.handle === link.to).displayTitle}</span></label>
        {placement.kind === "inline" ? <p className="text-sm">Links the words "{placement.match}" in: {placement.before}<strong>{placement.match}</strong>{placement.after}</p>
          : <p className="text-sm">Adds it to "See also:" at the end of the note</p>}
        <p className="text-sm text-[var(--color-muted)]">{link.reason}</p>
      </div>;
    })}
    <button className="app-button text-sm" disabled={disabled} onClick={() => untick(linksItemIds({ links }))}>Untick this note</button>
  </article>;
}
