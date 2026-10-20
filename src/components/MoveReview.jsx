import { ReadOnlyBody, effectLabel } from "./ChangeCard.jsx";
import { noteTitle } from "../lib/notebookView.js";
import { htmlToText } from "../lib/text.js";

const display = (note) => note.displayTitle ?? noteTitle({ ...note, text: htmlToText(note.html) });
const folderLabel = (folder, note, folders) => folder.action === "keep" ? folders.find((item) => item.id === note.folderId)?.name ?? "No folder" : `${folder.name ?? "No folder"}${folder.action === "create" ? " (new folder)" : ""}`;
function Lines({ items, label, field }) {
  if (!items.length) return null;
  const list = (rows) => [...new Set(rows.map((item) => item[field]))].map((title) => <div key={title}><h4 className="font-medium">{title}</h4><ul className="list-disc space-y-1 pl-5">{rows.filter((item) => item[field] === title).map((item, index) => <li key={index}>{item.text}</li>)}</ul></div>);
  return <div className="space-y-2 text-sm"><h3 className="font-semibold">{label}</h3>{list(items.slice(0, 8))}{items.length > 8 && <details><summary className="min-h-11 cursor-pointer py-2">Show all {items.length}</summary>{list(items.slice(8))}</details>}</div>;
}
function Effects({ proposal, titles }) {
  return <>{proposal.effects.map((effect, index) => <p key={index} className="text-sm">{effectLabel(effect, titles)}</p>)}</>;
}
export function MergeReview({ payload, proposal, titles }) {
  const kept = payload.notes[0];
  return <div className="space-y-4">
    <h2 className="text-xl font-semibold">Merge {payload.notes.length} notes into “{kept.displayTitle}”</h2>
    {kept.title !== proposal.title && <p>Title: {kept.title || "Untitled"} → {proposal.title || "Untitled"}</p>}
    <div><p>Tags: {proposal.tags.join(", ") || "none"}</p>{proposal.droppedTags.map(({ tag, from }) => <p key={tag}>− {tag} (from {from.join(", ")})</p>)}</div>
    <p>Folder: {proposal.folder.action !== "keep" && `${payload.folders.find((folder) => folder.id === kept.folderId)?.name ?? "No folder"} → `}{folderLabel(proposal.folder, kept, payload.folders)}</p>
    {proposal.pinned && <p>{kept.pinned ? "Stays pinned" : `Pinned (like ${payload.notes.filter((note) => note.pinned).map(display).join(", ")})`}</p>}
    <h3 className="font-semibold">The merged note</h3><ReadOnlyBody html={proposal.html} />
    <p>Keeps “{kept.displayTitle}” (the oldest), so links to it keep working.</p>
    <p>Moves to Trash: {payload.notes.slice(1).map(display).join(", ")} (restorable for 30 days)</p>
    {!!payload.backlinks.length && <p>Also updates links in: {payload.backlinks.map((note) => note.displayTitle).join(", ")} (they will open the merged note)</p>}
    {!!proposal.groupLinksRemoved && <p>Links between these notes become plain text ({proposal.groupLinksRemoved})</p>}
    <Effects proposal={proposal} titles={titles} />
    <Lines items={proposal.lines.missing} field="from" label="Not in the merged note word for word:" />
    <Lines items={proposal.lines.added} field="in" label="New wording:" />
    {payload.notes.map((note) => <details key={note.id}><summary className="min-h-11 cursor-pointer py-2">{note.displayTitle} as it is now</summary><ReadOnlyBody html={note.html} /></details>)}
    <p>{proposal.reason}</p>
  </div>;
}
export function SplitReview({ payload, proposal, titles }) {
  return <div className="space-y-4">
    <h2 className="text-xl font-semibold">Split “{display(payload.note)}” into {proposal.notes.length} new {proposal.notes.length === 1 ? "note" : "notes"}</h2>
    <h3 className="font-semibold">This note keeps</h3>
    {proposal.title !== null && <p>Title: {payload.note.title || "Untitled"} → {proposal.title || "Untitled"}</p>}
    <ReadOnlyBody html={proposal.remaining} />
    <p>Then adds: Split into: {proposal.notes.map(display).join(" · ")}</p>
    {proposal.notes.map((note, index) => <article key={index} aria-label={display(note)} className="space-y-2 rounded-[14px] border border-[var(--color-line)] bg-white px-3.5 py-3">
      <h3 className="text-lg font-semibold">{display(note)}</h3><p>Folder: {folderLabel(note.folder, payload.note, payload.folders)}</p>
      <p>Tags: {note.tags.join(", ") || "none"}</p><p>{note.reason}</p><ReadOnlyBody html={note.html} />
    </article>)}
    <Effects proposal={proposal} titles={titles} />
    <Lines items={proposal.lines.missing} field="from" label="Not kept word for word:" />
    <Lines items={proposal.lines.added} field="in" label="New wording:" />
    {proposal.formatting.map(({ mark, before, after }) => <p key={mark}>Formatting: {mark} on {before} → {after} characters</p>)}
  </div>;
}
