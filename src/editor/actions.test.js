import { expect, it, vi } from "vitest";
import { actions, resolveAction } from "./actions.js";

it("resolves every existing fixed action unchanged, with a group", () => {
  for (const action of actions) {
    expect(resolveAction(action.id)).toBe(action);
    expect(["Text", "Colours", "Lines & blocks", "Insert", "Tools"]).toContain(action.group);
  }
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
