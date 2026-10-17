import { X } from "lucide-react";
import ActionButton from "./ActionButton.jsx";
import { ActionButtons } from "./Toolbar.jsx";

function MoreTray({ ids, ...props }) {
  return <div className="flex flex-wrap gap-0.5"><ActionButtons ids={ids} {...props} /></div>;
}

// Future picker actions declare tray: "textColor", etc. and add a renderer here.
export const TRAYS = Object.freeze(Object.assign(Object.create(null), {
  more: { label: "More", render: MoreTray },
}));

export default function Tray({ name, viewportHeight, onClose, ...props }) {
  const tray = TRAYS[name];
  if (!tray) return null;
  const Contents = tray.render;
  return <section aria-label={`${tray.label} tray`} className="mx-auto max-w-2xl overflow-y-auto border-t border-gray-200 bg-white p-2 shadow-lg"
    style={{ maxHeight: viewportHeight * 0.4 }}>
    <div className="flex items-center justify-between">
      <h2 className="px-2 text-sm font-semibold">{tray.label}</h2>
      <ActionButton label="Close tray" onAction={onClose}><X size={18} aria-hidden="true" /></ActionButton>
    </div>
    <Contents {...props} />
  </section>;
}
