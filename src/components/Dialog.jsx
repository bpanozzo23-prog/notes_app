import { createContext, useContext, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../lib/overlays.jsx";

const focusables = (node) => [...node.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')];

export const DialogLock = createContext(false);

// Open layers are the lock's references. Keep the first snapshot until the last
// dialog closes, even if React unmounts an outer dialog before its confirmation.
const openLayers = new Set(), originalInert = new Map();
let originalOverflow;
function lockBackground(layer) {
  if (!openLayers.size) originalOverflow = document.body.style.overflow;
  for (const node of document.body.children) {
    if (!originalInert.has(node)) originalInert.set(node, node.inert);
  }
  openLayers.add(layer);
  updateBackground();
  return () => {
    openLayers.delete(layer);
    if (openLayers.size) updateBackground();
    else {
      for (const [node, inert] of originalInert) node.inert = inert;
      originalInert.clear();
      document.body.style.overflow = originalOverflow;
    }
  };
}
function updateBackground() {
  const top = [...openLayers].at(-1);
  for (const node of originalInert.keys()) node.inert = node !== top;
  document.body.style.overflow = "hidden";
}

export default function Dialog(props) {
  return useContext(DialogLock) ? null : <DialogPanel {...props} />;
}

function DialogPanel({ title, children, onClose, busy = false, sheet = false, fullScreen = false, fullWidth = false, descriptionId, footer }) {
  useOverlay(true, onClose, busy);
  const titleId = useId();
  const panel = useRef(null);
  const layer = useRef(null);
  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const unlock = lockBackground(layer.current);
    (panel.current.querySelector("[data-initial-focus]:not(:disabled)") ?? focusables(panel.current)[0] ?? panel.current).focus();
    return () => {
      unlock();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<div ref={layer} className={`fixed inset-0 z-50 flex justify-center bg-black/30 ${sheet ? "items-end" : "items-center p-4"}`}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1}
      className={`w-full ${fullWidth ? "max-w-none" : "max-w-md"} bg-[var(--color-paper)] shadow-xl ${fullScreen ? "h-dvh max-h-dvh" : "max-h-[85dvh]"} ${sheet && !fullScreen ? "rounded-t-2xl" : "rounded-xl"} ${footer ? "flex flex-col overflow-hidden" : "overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
        if (event.key !== "Tab") return;
        const elements = focusables(panel.current);
        const first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); panel.current.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
          event.preventDefault(); first.focus();
        }
      }}>
      <div className={footer ? `min-h-0 overflow-y-auto p-5 ${fullWidth ? "flex flex-1 flex-col" : ""}` : undefined}>
        <h2 id={titleId} className="mb-3 break-words text-lg font-semibold">{title}</h2>
        {children}
      </div>
      {footer && <div className="shrink-0 border-t border-[var(--color-line)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
    </div>
  </div>, document.body);
}
