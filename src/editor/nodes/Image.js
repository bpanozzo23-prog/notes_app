import { Node } from "@tiptap/core";
import { isSafeId } from "../../lib/ids.js";
import { acquire, release } from "../fileUrls.js";

const dimension = (value) => /^\d+$/.test(value ?? "") && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
export default Node.create({
  name: "image", group: "block", atom: true, selectable: true, draggable: false,
  addAttributes() {
    return {
      file: { default: null, parseHTML: (el) => el.getAttribute("data-file") },
      width: { default: null, parseHTML: (el) => dimension(el.getAttribute("width")) },
      height: { default: null, parseHTML: (el) => dimension(el.getAttribute("height")) },
      alt: { default: "" },
    };
  },
  parseHTML() { return [{ tag: "img[data-file]", getAttrs: (el) => isSafeId(el.getAttribute("data-file")) ? null : false }]; },
  renderHTML({ node }) {
    const { file, width, height, alt } = node.attrs;
    return ["img", { "data-file": file, ...(width ? { width } : {}), ...(height ? { height } : {}), alt }];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div"), img = document.createElement("img"), message = document.createElement("span");
      dom.className = "note-image";
      dom.contentEditable = "false";
      dom.dataset.file = node.attrs.file;
      const { width, height, alt, file } = node.attrs;
      if (width) { dom.style.maxWidth = `${width}px`; img.width = width; }
      if (height) img.height = height;
      dom.style.aspectRatio = width && height ? `${width} / ${height}` : "4 / 3";
      img.alt = alt; img.draggable = false; img.hidden = true;
      message.textContent = "Loading image…";
      dom.append(img, message);
      let alive = true;
      const missing = () => { if (alive) { img.hidden = true; message.hidden = false; message.textContent = "Image not found"; } };
      img.onerror = missing;
      img.onload = () => { if (alive) { img.hidden = false; message.hidden = true; } };
      acquire(file).then((url) => {
        if (!alive) return;
        if (url) img.src = url;
        else missing();
      });
      return { dom, selectNode: () => dom.classList.add("ProseMirror-selectednode"),
        deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
        ignoreMutation: () => true,
        destroy: () => { alive = false; img.onload = img.onerror = null; release(file); } };
    };
  },
});
