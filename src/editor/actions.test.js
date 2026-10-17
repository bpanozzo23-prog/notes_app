import { expect, it, vi } from "vitest";
import { actions, availableActions, resolveAction, DEFAULT_TOOLBAR } from "./actions.js";
import { resolveFormatting } from "./formatting.js";
import { Editor } from "@tiptap/core";
import { extensions } from "./extensions.js";

it("resolves every existing fixed action unchanged, with a group", () => {
  for (const action of actions) {
    expect(resolveAction(action.id)).toBe(action);
    expect(["Text", "Colours", "Lines & blocks", "Insert", "Tools"]).toContain(action.group);
  }
});

it("offers grouped actions with visible colours in palette order and uses renamed starter colours", () => {
  const formatting = resolveFormatting({});
  formatting.textColors = [
    { color: "#123456", name: "Ink", hidden: false },
    { color: "#15803d", name: "Forest", hidden: true },
    { color: "#dc2626", name: "Berry", hidden: false },
  ];
  const offered = availableActions(formatting);
  expect(offered.map((action) => action.id)).toEqual([
    "bold", "italic", "underline", "strike", "highlight", "color:none", "color:#123456", "color:#dc2626",
    "h1", "h2", "h3", "bulletList", "orderedList", "taskList", "blockquote", "hr", "link", "clearFormatting", "undo", "redo",
  ]);
  expect([...new Set(offered.map((action) => action.group))]).toEqual(["Text", "Colours", "Lines & blocks", "Insert", "Tools"]);
  expect(resolveAction("color:#dc2626", formatting).label).toBe("Berry");
  expect(resolveAction("color:#15803d", formatting).label).toBe("Forest");
});

it("adds Heading 3 without changing the default toolbar or the existing HTML vocabulary", () => {
  expect(DEFAULT_TOOLBAR).not.toContain("h3");
  const editor = new Editor({ extensions, content: "<p>Heading</p>" });
  const h3 = resolveAction("h3");
  h3.run({ editor });
  expect(editor.state.doc.firstChild.type.name).toBe("heading");
  expect(editor.state.doc.firstChild.attrs.level).toBe(3);
  expect(editor.state.doc.firstChild.textContent).toBe("Heading");
  expect(h3.isActive(editor)).toBe(true);
  h3.run({ editor });
  expect(editor.state.doc.firstChild.type.name).toBe("paragraph");
  expect(editor.state.doc.firstChild.textContent).toBe("Heading");
  editor.destroy();
});
it.each(["unknown", "__proto__", "constructor", "toString", "style:default-heading", "highlight:#aabbcc", "color:#abc", "color:blue", null, 4])(
  "skips unavailable action %j", (id) => expect(resolveAction(id)).toBeNull());
it("builds arbitrary colour actions with palette labels and recognises hex and rgb after reopening", () => {
  const action = resolveAction("color:#ABCDEF", { textColors: [{ color: "#abcdef", name: "Sky" }] });
  expect(action).toMatchObject({ color: "#abcdef", label: "Sky", group: "Colours" });
  for (const color of ["#abcdef", "#ABCDEF", "rgb(171, 205, 239)"]) expect(action.isActive({ getAttributes: () => ({ color }) })).toBe(true);
  expect(action.isActive({ getAttributes: () => ({ color: "#123456" }) })).toBe(false);
  expect(resolveAction("color:#123456").label).toBe("#123456");
  const chain = { focus: vi.fn().mockReturnThis(), setColor: vi.fn().mockReturnThis(), run: vi.fn() };
  action.run({ editor: { chain: () => chain } });
  expect(chain.setColor).toHaveBeenCalledExactlyOnceWith("#abcdef");
  expect(chain.run).toHaveBeenCalledOnce();
});
