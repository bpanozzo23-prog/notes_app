import { getFile } from "../db/files.js";
import { db } from "../db/db.js";

const cache = new Map();
export function acquire(id) {
  let entry = cache.get(id);
  if (!entry) {
    entry = { refs: 0, url: null };
    cache.set(id, entry);
    entry.promise = db.transaction("r", db.files, db.fileData, async () => {
      const file = await getFile(id);
      const data = file && await db.fileData.get(id);
      // A released or cleared pending read must never resurrect a URL.
      if (!file || !data || cache.get(id) !== entry || !entry.refs) return null;
      entry.url = URL.createObjectURL(new Blob([data.bytes], { type: file.type }));
      return entry.url;
    }).catch(() => null);
  }
  entry.refs++;
  return entry.promise;
}
export function release(id) {
  const entry = cache.get(id);
  if (!entry || --entry.refs > 0) return;
  if (entry.url) URL.revokeObjectURL(entry.url);
  cache.delete(id);
}
export function clearFileUrls() {
  for (const entry of cache.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  cache.clear();
}
