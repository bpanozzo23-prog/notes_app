import { useLayoutEffect, useRef, useState } from "react";
import { buttonsPerRow } from "./toolbarLayout.js";

const viewport = () => ({
  width: window.visualViewport?.width ?? window.innerWidth,
  height: window.visualViewport?.height ?? window.innerHeight,
  top: window.visualViewport?.offsetTop ?? 0,
  left: window.visualViewport?.offsetLeft ?? 0,
});

export function useVisibleViewport() {
  const [size, setSize] = useState(viewport);
  useLayoutEffect(() => {
    const update = () => setSize(viewport());
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  return size;
}

export function useToolbarSize() {
  const ref = useRef(null);
  const [perRow, setPerRow] = useState(() => buttonsPerRow(Math.min(window.innerWidth, 672) - 16));
  useLayoutEffect(() => {
    const node = ref.current;
    const measure = () => {
      const css = getComputedStyle(node);
      const width = node.clientWidth - parseFloat(css.paddingLeft || 0) - parseFloat(css.paddingRight || 0);
      if (width > 0) setPerRow(buttonsPerRow(width));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return { ref, perRow };
}
