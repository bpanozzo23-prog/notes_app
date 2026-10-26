import { useEffect, useRef } from "react";

export function useLongPress({ onTap, onLongPress, delay = 500, moveTolerance = 10 }) {
  const press = useRef({ timer: null, start: null, suppress: false });
  const cancel = () => { clearTimeout(press.current.timer); press.current.timer = null; press.current.start = null; };
  useEffect(() => cancel, []);
  const abandon = () => { cancel(); press.current.suppress = true; };
  return {
    onContextMenu: (event) => event.preventDefault(),
    onPointerDown: (event) => {
      if (event.button > 0 || event.currentTarget.disabled) return;
      cancel();
      const state = press.current;
      state.suppress = false; state.start = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      state.timer = setTimeout(() => { state.timer = null; state.suppress = true; onLongPress(); }, delay);
    },
    onPointerMove: (event) => {
      const start = press.current.start;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > moveTolerance) abandon();
    },
    onPointerUp: cancel,
    onPointerCancel: abandon,
    // Touch fires pointerleave right after pointerup and before click, so leaving only ends the
    // hold; whether a click follows is the browser's call.
    onPointerLeave: cancel,
    onClick: (event) => {
      if (press.current.suppress) { event.preventDefault(); event.stopPropagation(); press.current.suppress = false; }
      else if (!event.currentTarget.disabled) onTap();
    },
  };
}
