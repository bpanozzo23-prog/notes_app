import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { NodeSelection, Selection } from "@tiptap/pm/state";

export const DIVIDER_STYLES = ["thin", "thick", "dashed", "dotted"];

export default HorizontalRule.extend({
  addAttributes() {
    return { dividerStyle: {
      default: "thin",
      parseHTML: (element) => DIVIDER_STYLES.includes(element.dataset.style) ? element.dataset.style : "thin",
      renderHTML: ({ dividerStyle }) => dividerStyle === "thin" ? {} : { "data-style": dividerStyle },
    } };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setDivider: (dividerStyle) => ({ tr, dispatch, chain }) => {
        if (!DIVIDER_STYLES.includes(dividerStyle)) return false;
        if (tr.selection instanceof NodeSelection && tr.selection.node.type === this.type) {
          if (dispatch) tr.setNodeMarkup(tr.selection.from, undefined, { dividerStyle });
          return true;
        }
        const content = { type: this.name, attrs: { dividerStyle } };
        const insert = tr.selection instanceof NodeSelection
          ? chain().insertContentAt(tr.selection.to, content) : chain().insertContent(content);
        return insert.command(({ tr, dispatch }) => {
          if (dispatch) {
            const pos = tr.selection.to;
            if (!tr.doc.resolve(pos).nodeAfter) tr.insert(pos, tr.doc.type.schema.nodes.paragraph.create());
            tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
          }
          return true;
        }).run();
      },
    };
  },
});
