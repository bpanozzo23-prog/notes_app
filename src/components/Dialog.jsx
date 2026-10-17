import { createContext, useContext, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../lib/overlays.jsx";

const focusables = (node) => [...node.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];

export const DialogLock = createContext(false);

export default function Dialog(props) {
  return useContext(DialogLock) ? null : <DialogPanel {...props} />;
}

function DialogPanel({ title, children, onClose, busy = false, sheet = false, descriptionId, footer }) {
  useOverlay(true, onClose, busy);
  const titleId = useId();
  const panel = useRef(null);
  const layer = useRef(null);
  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const siblings = [...document.body.children].filter((node) => node !== layer.current);
    const previousInert = siblings.map((node) => node.inert);
    siblings.forEach((node) => { node.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (panel.current.querySelector("[data-initial-focus]:not(:disabled)") ?? focusables(panel.current)[0] ?? panel.current).focus();
    return () => {
      siblings.forEach((node, i) => { node.inert = previousInert[i]; });
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<div ref={layer} className={`fixed inset-0 z-50 flex justify-center bg-black/30 ${sheet ? "items-end" : "items-center p-4"}`}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1}
      className={`w-full max-w-md bg-[var(--color-paper)] shadow-xl max-h-[85dvh] ${sheet ? "rounded-t-2xl" : "rounded-xl"} ${footer ? "flex flex-col overflow-hidden" : "overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"}`}
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
      <div className={footer ? "min-h-0 overflow-y-auto p-5" : undefined}>
        <h2 id={titleId} className="mb-3 break-words text-lg font-semibold">{title}</h2>
        {children}
      </div>
      {footer && <div className="shrink-0 border-t border-[var(--color-line)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
    </div>
  </div>, document.body);
}
