import { expect, it, vi } from "vitest";
import { actions, availableActions, resolveAction, DEFAULT_TOOLBAR } from "./actions.js";
import { resolveFormatting } from "./formatting.js";
import { Editor } from "@tiptap/core";
import { extensions } from "./extensions.js";

it("resolves every existing fixed action unchanged, with a group", () => {
  for (const action of actions) {
    expect(resolveAction(action.id)).toMatchObject({ id: action.id, label: action.label });
    expect(["Text", "Colours", "Size & font", "Lines & blocks", "Named styles", "Insert", "Tools"]).toContain(action.group);
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
  expect(offered.filter((action) => action.id.startsWith("color:")).map((action) => action.id))
    .toEqual(["color:none", "color:#123456", "color:#dc2626"]);
  expect(offered.map((action) => action.id)).toEqual(expect.arrayContaining([
    "textColor", "highlightColor", "highlight", "highlight:none", "fontSize", "fontFamily",
    "lineHeight", "callout", "callout:note", "callout:tip", "callout:warning", "callout:important",
    "hr", "divider", "hr:thick", "hr:dashed", "hr:dotted",
  ]));
  expect([...new Set(offered.map((action) => action.group))]).toEqual(["Text", "Colours", "Size & font", "Lines & blocks", "Named styles", "Insert", "Tools"]);
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
it.each(["unknown", "__proto__", "constructor", "toString", "style:default-heading", "color:#abc", "color:blue", null, 4])(
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


it("toggles a plain mark off, including after palette reorder, and uses yellow when all colours are hidden", () => {
  const editor = new Editor({ extensions, content: "<p><mark>Hello</mark></p>" });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  const formatting = resolveFormatting({});
  formatting.highlightColors.reverse();
  const action = resolveAction("highlight", formatting);
  expect(action.isActive(editor)).toBe(true);
  action.run({ editor });
  expect(editor.getHTML()).toBe("<p>Hello</p>");
  formatting.highlightColors.forEach((entry) => { entry.hidden = true; });
  resolveAction("highlight", formatting).run({ editor });
  expect(editor.getAttributes("highlight").color).toBe("#fde68a");
  resolveAction("highlight:#fde68a", formatting).run({ editor });
  expect(editor.getHTML()).toBe("<p>Hello</p>");
  editor.destroy();
});

it("normalises highlight rgb and plain yellow, requiring the entire selection to match", () => {
  const editor = new Editor({ extensions, content: '<p><mark data-color="rgb(253, 230, 138)">one</mark><mark>two</mark>three</p>' });
  const yellow = resolveAction("highlight:#fde68a", resolveFormatting({}));
  expect(yellow.label).toBe("Yellow highlight");
  editor.commands.setTextSelection({ from: 1, to: 7 });
  expect(yellow.isActive(editor)).toBe(true);
  editor.commands.setTextSelection({ from: 1, to: 12 });
  expect(yellow.isActive(editor)).toBe(false);
  yellow.run({ editor });
  expect(yellow.isActive(editor)).toBe(true);
  yellow.run({ editor });
  expect(editor.getHTML()).toBe('<p>onetwothree</p>');
  editor.destroy();
});

it("keeps hidden/deleted pinned colours working and keeps them out of the Add sheet", () => {
  const formatting = resolveFormatting({ textColors: [], highlightColors: [] });
  expect(availableActions(formatting).some((action) => /^(color|highlight):#/.test(action.id))).toBe(false);
  expect(resolveAction("color:#dc2626", formatting).label).toBe("#dc2626");
  expect(resolveAction("highlight:#fde68a", formatting).label).toBe("#fde68a highlight");
});

it("sets the first palette highlight on a mixed plain/coloured selection instead of treating it as entirely plain", () => {
  const formatting = resolveFormatting({});
  formatting.highlightColors.reverse();
  const editor = new Editor({ extensions, content: '<p><mark>one</mark><mark data-color="#bfdbfe">two</mark></p>' });
  editor.commands.setTextSelection({ from: 1, to: 7 });
  const action = resolveAction("highlight", formatting);
  expect(action.isActive(editor)).toBe(false);
  action.run({ editor });
  expect(editor.getAttributes("highlight").color).toBe(formatting.highlightColors[0].color);
  expect(action.isActive(editor)).toBe(true);
  editor.destroy();
});

it("offers named styles in owner order and adds only the two requested default toolbar buttons", () => {
  const formatting = resolveFormatting({});
  formatting.namedStyles.push({ ...formatting.namedStyles[0], id: "second", name: "Second" });
  expect(availableActions(formatting).filter((action) => action.group === "Named styles").map((action) => action.id))
    .toEqual(["styles", "style:default-heading", "style:second"]);
  expect(DEFAULT_TOOLBAR.slice(DEFAULT_TOOLBAR.indexOf("fontSize"), DEFAULT_TOOLBAR.indexOf("fontSize") + 3)).toEqual(["fontSize", "styles", "painter"]);
});

it("offers one Heading button that replaces Heading 1 and 2 in the default toolbar", () => {
  expect(resolveAction("heading")).toMatchObject({ label: "Heading", tray: "heading", group: "Lines & blocks" });
  expect(DEFAULT_TOOLBAR).toContain("heading");
  expect(DEFAULT_TOOLBAR).not.toContain("h1");
  expect(DEFAULT_TOOLBAR).not.toContain("h2");
  // The separate buttons stay available for anyone who prefers them.
  expect(availableActions({}).map((action) => action.id)).toEqual(expect.arrayContaining(["heading", "h1", "h2", "h3"]));
});
