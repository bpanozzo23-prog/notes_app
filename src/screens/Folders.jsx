import { useState } from "react";
import { ArrowUp, ArrowDown, Pencil, Trash2 } from "lucide-react";
import { createFolder, renameFolder, reorderFolders, deleteFolder } from "../db/folders.js";
import ScreenHeader from "../components/ScreenHeader.jsx";
import Confirm from "../components/Confirm.jsx";

export default function Folders({ folders, notes, trash, refresh, run, busy, readOnly, onBack, error }) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState(null);
  const count = deleting ? [...notes, ...trash].filter((note) => note.folderId === deleting.id).length : 0;
  async function change(task) { return run(async () => { await task(); await refresh(); }); }
  function move(index, delta) {
    const ids = folders.map((folder) => folder.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void change(() => reorderFolders(ids));
  }
  return <section>
    <ScreenHeader title="Folders" onBack={onBack} busy={busy} />
    <fieldset disabled={busy || readOnly} className="min-w-0 px-4 pb-8">
      <form className="my-3 flex gap-2" onSubmit={async (event) => {
        event.preventDefault();
        if (await change(() => createFolder(name))) setName("");
      }}>
        <input className="app-input min-w-0 flex-1" aria-label="New folder name" placeholder="New folder" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="app-button" disabled={busy || !name.trim()}>Create</button>
      </form>
      {!folders.length && <p className="py-6 text-[var(--color-muted)]">No folders yet.</p>}
      <ul className="divide-y divide-[var(--color-line)]">
        {folders.map((folder, index) => <li key={folder.id} className="py-3">
          {renaming === folder.id ? <form className="space-y-2" onSubmit={async (event) => {
            event.preventDefault();
            if (await change(() => renameFolder(folder.id, rename))) setRenaming(null);
          }}>
            <input autoFocus className="app-input w-full" aria-label="Folder name" value={rename} onChange={(event) => setRename(event.target.value)} />
            <div className="flex gap-2"><button className="app-button primary" disabled={busy || !rename.trim()}>Save name</button><button type="button" className="app-button" onClick={() => setRenaming(null)}>Cancel</button></div>
          </form> : <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 break-words font-medium">{folder.name}</p>
            <div className="flex shrink-0">
              <button className="icon-button" aria-label={`Move ${folder.name} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={18} aria-hidden="true" /></button>
              <button className="icon-button" aria-label={`Move ${folder.name} down`} disabled={busy || index === folders.length - 1} onClick={() => move(index, 1)}><ArrowDown size={18} aria-hidden="true" /></button>
              <button className="icon-button" aria-label={`Rename ${folder.name}`} onClick={() => { setRenaming(folder.id); setRename(folder.name); }}><Pencil size={18} aria-hidden="true" /></button>
              <button className="icon-button text-red-700" aria-label={`Delete ${folder.name}`} onClick={() => setDeleting(folder)}><Trash2 size={18} aria-hidden="true" /></button>
            </div>
          </div>}
        </li>)}
      </ul>
    </fieldset>
    {deleting && <Confirm tone="danger" title={`Delete folder “${deleting.name}”?`} confirmLabel="Delete folder" busy={busy} error={error} onCancel={() => setDeleting(null)} onConfirm={async () => {
      if (await change(() => deleteFolder(deleting.id))) setDeleting(null);
    }}>{count} {count === 1 ? "note" : "notes"} (including any in Trash) will move to no folder. The notes will be kept.</Confirm>}
  </section>;
}
