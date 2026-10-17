import { expect, it } from "vitest";
import { buttonsPerRow, MORE_BUTTON, splitToolbar } from "./toolbarLayout.js";

it.each([[359, 8], [396, 9], [656, 15], [40, 1], [82, 2], [81, 1]])("fits 40 px buttons with 2 px gaps in %i px", (width, expected) => {
  expect(buttonsPerRow(width)).toBe(expected);
});
it.each([1, 8, 9, 15])("splits every layout at capacity %i without losing or reordering ids", (perRow) => {
  for (const count of [0, 1, perRow, perRow + 1, 2 * perRow, 2 * perRow + 1, 40, 100]) {
    const ids = Array.from({ length: count }, (_, i) => `action-${i}`);
    for (const layout of ["scroll", "rows", "more"]) {
      const { rows, more } = splitToolbar(ids, perRow, layout);
      const visible = rows.flat().filter((id) => id !== MORE_BUTTON);
      expect([...visible, ...more]).toEqual(ids);
      expect(ids).toHaveLength(count);
      if (layout === "scroll") {
        expect(rows).toHaveLength(count ? 1 : 0);
        expect(more).toEqual([]);
      } else {
        const capacity = perRow * (layout === "rows" ? 2 : 1);
        expect(rows.every((row) => row.length <= perRow)).toBe(true);
        expect(rows.length).toBeLessThanOrEqual(layout === "rows" ? 2 : 1);
        expect(rows.length).toBe(count === 0 ? 0 : count <= perRow || layout === "more" ? 1 : 2);
        expect(more.length).toBe(count > capacity ? count - capacity + 1 : 0);
        if (more.length) expect(rows.at(-1).at(-1)).toBe(MORE_BUTTON);
      }
    }
  }
});
