import { RangeSet, rangesOverlap } from "dexie";
import { EXPORTED_PREFS } from "../db/backup.js";
import { syncOutbox } from "./prefs.js";

const tables = new Set(["notes", "folders", "tombstones", "files", "fileData"]);
const preferences = new RangeSet().addKeys([...EXPORTED_PREFS, syncOutbox]);
export function affectsSync(parts) {
  return Object.entries(parts).some(([part, ranges]) => {
    const match = /^idb:\/\/notes_app\/([^/]+)\/(.*)$/.exec(part);
    if (!match || !ranges?.d) return false;
    const [, table, index] = match;
    return tables.has(table) || table === "prefs" && ["", ":dels"].includes(index) && rangesOverlap(ranges, preferences);
  });
}
