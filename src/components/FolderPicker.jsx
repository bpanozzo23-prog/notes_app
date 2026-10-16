import { useState } from "react";
import { Folder, ChevronDown, Check } from "lucide-react";
import Dialog from "./Dialog.jsx";

export default function FolderPicker({ folders, value, onChange }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="flex min-h-11 min-w-0 items-center gap-1 text-sm" aria-label="Choose folder" onClick={() => setOpen(true)}>
      <Folder size={16} className="shrink-0" aria-hidden="true" />
      <span className="max-w-36 truncate">{folders.find((folder) => folder.id === value)?.name ?? "No folder"}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <Dialog title="Choose folder" sheet onClose={() => setOpen(false)}>
      <div className="space-y-1">
        {[{ id: null, name: "No folder" }, ...folders].map((folder) => <button key={folder.id ?? "none"}
          aria-pressed={value === folder.id} className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-2 text-left hover:bg-black/5"
          onClick={() => { onChange(folder.id); setOpen(false); }}>
          <span className="break-words min-w-0">{folder.name}</span>{value === folder.id && <Check size={18} className="shrink-0" aria-hidden="true" />}
        </button>)}
      </div>
      <button className="app-button mt-4 w-full" onClick={() => setOpen(false)}>Cancel</button>
    </Dialog>}
  </>;
}
