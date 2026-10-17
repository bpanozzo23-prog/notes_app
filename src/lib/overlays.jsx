import { createContext, useContext, useLayoutEffect, useRef } from "react";

export const OverlayNavigation = createContext(null);

// Register only mounted overlays; the last one opened gets Back first. Keep its callback
// current without changing its place in the stack on every render (or every search keystroke).
export function useOverlay(open, onClose, busy = false) {
  const navigation = useContext(OverlayNavigation);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  useLayoutEffect(() => {
    if (open && !busy) return navigation?.registerOverlay(() => { close.current(); return true; });
  }, [navigation, open, busy]);
}
