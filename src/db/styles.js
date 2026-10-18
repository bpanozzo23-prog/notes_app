import { allPrefs, db, writeTransaction } from "./db.js";
import { resolveFormatting, sanitizePreference } from "../editor/formatting.js";

function checked(key, value) {
  const result = sanitizePreference(key, value);
  if (result.warnings.length || result.value === undefined) throw new Error(key === "namedStyles"
    ? "Check the style name and formatting. Up to 50 styles can be saved."
    : "The toolbar is full. Remove a button before adding another.");
  return result.value;
}

export function saveNamedStyle(style, { toolbarChanged = false, inToolbar = false } = {}) {
  return writeTransaction([db.prefs], async () => {
    const formatting = resolveFormatting(await allPrefs());
    const exists = formatting.namedStyles.some((entry) => entry.id === style.id);
    const styles = exists ? formatting.namedStyles.map((entry) => entry.id === style.id ? style : entry) : [...formatting.namedStyles, style];
    await db.prefs.put({ key: "namedStyles", value: checked("namedStyles", styles) });
    if (toolbarChanged) {
      const id = `style:${style.id}`;
      const toolbar = formatting.toolbar.filter((entry) => entry !== id);
      // Keep existing order/duplicates when already present; append only a newly enabled button.
      const next = inToolbar ? formatting.toolbar.includes(id) ? formatting.toolbar : [...toolbar, id] : toolbar;
      await db.prefs.put({ key: "toolbar", value: checked("toolbar", next) });
    }
  });
}

export function deleteNamedStyle(id) {
  return writeTransaction([db.prefs], async () => {
    const formatting = resolveFormatting(await allPrefs());
    await db.prefs.put({ key: "namedStyles", value: formatting.namedStyles.filter((entry) => entry.id !== id) });
    for (const key of ["toolbar", "selectionMenu"]) {
      if (formatting[key].includes(`style:${id}`)) await db.prefs.put({ key, value: formatting[key].filter((entry) => entry !== `style:${id}`) });
    }
  });
}
