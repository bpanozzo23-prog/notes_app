import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function LabelBubble({ label, anchor }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.top });
  useLayoutEffect(() => {
    const bubble = ref.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    setPosition({
      left: Math.max(left + 8, Math.min(anchor.left + (anchor.width - bubble.width) / 2, left + width - bubble.width - 8)),
      top: Math.max(top + 8, Math.min(anchor.top - bubble.height - 6, top + height - bubble.height - 8)),
    });
  }, [anchor]);
  return createPortal(<span ref={ref} role="tooltip" className="action-label" style={position}>{label}</span>, document.body);
}

export function ActionIcon({ action, size = 20 }) {
  const Icon = action.icon;
  if (action.tray === "textColor" || action.tray === "highlightColor") return <span className="flex flex-col items-center" aria-hidden="true">
    <Icon size={size} /><span className="h-1 w-5 rounded" style={{ background: action.barColor ?? "transparent" }} />
  </span>;
  if (action.id.startsWith("highlight:")) return <span aria-hidden="true" className="rounded px-0.5" style={{ background: action.color ?? "transparent" }}><Icon size={size} /></span>;
  if (action.dividerStyle) return <span aria-hidden="true" className={`divider-preview divider-${action.dividerStyle}`} />;
  if (action.calloutType) return <span aria-hidden="true" className={`callout-icon callout-${action.calloutType}`}><Icon size={size} /></span>;
  return action.id.startsWith("color:") ? <span aria-hidden="true" className="block h-5 w-5 shrink-0 rounded-full border border-gray-300"
    style={{ background: action.color ?? "linear-gradient(135deg,#fff 45%,#999 50%,#fff 55%)" }} /> : <Icon size={size} aria-hidden="true" />;
}

export default function ActionButton({ label, children, onAction, disabled, pressed, expanded, compact = true }) {
  const button = useRef(null);
  const timer = useRef(null), expiry = useRef(null), pointer = useRef(null), suppress = useRef(false);
  const [anchor, setAnchor] = useState(null);
  const cancelTimer = () => { clearTimeout(timer.current); timer.current = null; };
  const hide = () => { clearTimeout(expiry.current); setAnchor(null); };
  const show = () => {
    setAnchor(button.current.getBoundingClientRect());
    clearTimeout(expiry.current);
    expiry.current = setTimeout(() => setAnchor(null), 1500);
  };
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(expiry.current); }, []);
  return <>
    <button ref={button} type="button" title={label} aria-label={label} disabled={disabled}
      aria-pressed={pressed} aria-expanded={expanded}
      className={compact ? "icon-button formatting-button" : "formatting-button-text"}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.preventDefault();
        cancelTimer(); hide(); suppress.current = false;
        if (event.button > 0) return;
        pointer.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        timer.current = setTimeout(() => { suppress.current = true; show(); }, 500);
      }}
      onPointerMove={(event) => {
        if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 10) {
          cancelTimer(); hide(); suppress.current = true;
        }
      }}
      onPointerUp={() => { cancelTimer(); hide(); pointer.current = null; }}
      onPointerCancel={() => { cancelTimer(); hide(); pointer.current = null; suppress.current = true; }}
      onPointerEnter={(event) => {
        if (event.pointerType === "pen" && event.buttons === 0 && !pointer.current) {
          cancelTimer(); timer.current = setTimeout(show, 300);
        }
      }}
      onPointerLeave={() => { cancelTimer(); hide(); }}
      onClick={() => {
        cancelTimer(); hide();
        if (suppress.current) { suppress.current = false; return; }
        onAction?.();
      }}>
      {children}
    </button>
    {anchor && <LabelBubble label={label} anchor={anchor} />}
  </>;
}
