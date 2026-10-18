import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { processImage } from "../lib/images.js";
import { addImageFile } from "../db/files.js";

export const imagePlaceholders = new PluginKey("imagePlaceholders");
export const ImagePlaceholders = Extension.create({
  name: "imagePlaceholders",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: imagePlaceholders,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, decorations) {
          decorations = decorations.map(tr.mapping, tr.doc);
          const action = tr.getMeta(imagePlaceholders);
          if (action?.remove) decorations = decorations.remove(decorations.find(null, null, (spec) => spec.id === action.remove));
          if (action?.add) {
            const { id, pos } = action.add;
            decorations = decorations.add(tr.doc, [Decoration.widget(pos, () => {
              const span = document.createElement("span");
              span.className = "image-placeholder"; span.textContent = "Adding image…";
              return span;
            }, { id, side: 1 })]);
          }
          return decorations;
        },
      },
      props: { decorations: (state) => imagePlaceholders.getState(state) },
    })];
  },
});
export function reserveImagePosition(editor, pos = editor.state.selection.from) {
  const id = {};
  editor.view.dispatch(editor.state.tr.setMeta(imagePlaceholders, { add: { id, pos } }).setMeta("addToHistory", false));
  return id;
}
export function removeImagePosition(editor, id) {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(imagePlaceholders, { remove: id }).setMeta("addToHistory", false));
}
export function imagePosition(editor, id) {
  return imagePlaceholders.getState(editor.state)?.find(null, null, (spec) => spec.id === id)[0]?.from ?? editor.state.doc.content.size;
}
function imageError(error) {
  if (error?.name === "QuotaExceededError" || error?.inner?.name === "QuotaExceededError") return "There isn't enough storage space to add this image.";
  return ["This image is too large to add.", "This image can't be used here."].includes(error?.message) ? error.message : "This image can't be used here.";
}

// One serial lane per mounted note. The queue waits for the whole lane, including the edit
// emitted after the file row commits. Busy navigation may wait here; it must not cancel it.
export function createImageInserter({ editor, queue, mayStart = () => true, canInsert = () => true, report = () => {}, onPending = () => {}, process = processImage, store = addImageFile }) {
  let tail = Promise.resolve(), pending = 0, disposed = false;
  const valid = () => !disposed && !editor.isDestroyed && editor.isEditable && canInsert();
  return {
    dispose() { disposed = true; },
    insert(files, placeholder) {
      if (!mayStart() || !valid()) { if (placeholder) removeImagePosition(editor, placeholder); return Promise.resolve(); }
      const id = placeholder ?? reserveImagePosition(editor);
      const batch = Array.from(files);
      pending++; onPending(pending);
      const operation = tail.then(async () => {
        try {
          for (const file of batch) {
            try {
              if (!valid()) break;
              const image = await process(file);
              const fileId = await store(image); // Durable bytes precede the reference.
              if (!valid()) break;
              const pos = imagePosition(editor, id);
              editor.chain().command(({ tr }) => { closeHistory(tr); return true; })
                .insertContentAt(pos, { type: "image", attrs: { file: fileId, width: image.width, height: image.height, alt: "" } })
                .command(({ tr }) => {
                  let after;
                  tr.doc.descendants((node, at) => { if (node.type.name === "image" && node.attrs.file === fileId) after = at + node.nodeSize; });
                  if (after === undefined) throw new Error("Image insertion failed");
                  if (after === tr.doc.content.size) tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
                  tr.setSelection(Selection.near(tr.doc.resolve(after), 1));
                  tr.setMeta(imagePlaceholders, { remove: id, add: { id, pos: after } });
                  return true;
                }).run();
            } catch (error) { report(imageError(error)); }
          }
        } finally {
          removeImagePosition(editor, id);
          pending--; if (!disposed) onPending(pending);
        }
      });
      tail = operation.catch(() => {});
      queue?.track(operation);
      return operation;
    },
  };
}

export const imageFiles = (transfer) => Array.from(transfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
