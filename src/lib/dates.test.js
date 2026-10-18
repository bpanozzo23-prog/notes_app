import { expect, it } from "vitest";
import { noteDates, shortDate } from "./dates.js";

// Local times, so the expectations hold in any time zone.
const at = (y, m, d, h = 9, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 18, 15, 30);

it("shows a time today, a day this year and the year before that in the list", () => {
  expect(shortDate(at(2026, 10, 18, 14, 2), now)).toBe("14:02");
  expect(shortDate(at(2026, 10, 16), now)).toBe("16 Oct");
  expect(shortDate(at(2025, 12, 31), now)).toBe("31 Dec 2025");
  expect(shortDate("not a date", now)).toBe("");
});

it("describes creation and the last content edit at the end of a note", () => {
  expect(noteDates({ createdAt: at(2026, 10, 3), updatedAt: at(2026, 10, 18, 14, 2) }, now)).toBe("Created 3 Oct 2026 · Edited today, 14:02");
  expect(noteDates({ createdAt: at(2026, 10, 3), updatedAt: at(2026, 10, 17, 8, 5) }, now)).toBe("Created 3 Oct 2026 · Edited yesterday, 08:05");
  expect(noteDates({ createdAt: at(2026, 10, 3), updatedAt: at(2026, 10, 16, 21, 40) }, now)).toBe("Created 3 Oct 2026 · Edited 16 Oct, 21:40");
  expect(noteDates({ createdAt: at(2025, 3, 1), updatedAt: at(2025, 6, 9) }, now)).toBe("Created 1 Mar 2025 · Edited 9 Jun 2025");
  // A note never edited since it was created shows only its creation.
  expect(noteDates({ createdAt: at(2026, 10, 3), updatedAt: at(2026, 10, 3) }, now)).toBe("Created 3 Oct 2026");
});
