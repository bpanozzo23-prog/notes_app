import { expect, it } from "vitest";
import { saveStatusLabel } from "./saveStatus.js";

it.each([
  ["idle", "Saved"],
  ["pending", "Saving…"],
  ["saving", "Saving…"],
  ["error", "Not saved"],
])("labels %s as %s", (status, label) => {
  expect(saveStatusLabel(status)).toBe(label);
});
