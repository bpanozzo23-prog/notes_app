// Phone measurement fixtures only. No external pictures and no writes under public/.
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { makePng } from "./image-fixture.mjs";
const count = Number(process.argv[2]);
if (!Number.isSafeInteger(count) || count < 1) throw new Error("Usage: node scripts/make-image-backup.mjs <positive count>");
const at = "2026-10-17T12:00:00.000Z", width = 320, height = 320;
const notes = Array.from({ length: count }, (_, i) => ({
  id: `measurement-note-${i}`, title: `Made-up image ${i + 1}`, html: `<p>Generated measurement image.</p><img data-file="measurement-image-${i}" width="${width}" height="${height}" alt=""><p>End of example.</p>`,
  text: "Generated measurement image.\nEnd of example.", folderId: null, tags: [], linkedIds: [], pinned: false, rev: 1, createdAt: at, updatedAt: at, deletedAt: null,
}));
mkdirSync("private-data/image-backups", { recursive: true });
const path = `private-data/image-backups/image-backup-${count}.json`, fd = openSync(path, "w");
try {
  writeSync(fd, JSON.stringify({ format: "notes_app-backup", schemaVersion: 4, exportedAt: at, appVersion: "measurement", notes, folders: [], tombstones: [], preferences: {} }).slice(0, -1) + ',"files":[');
  for (let i = 0; i < count; i++) {
    const bytes = makePng(width, height, true, i + 1);
    writeSync(fd, (i ? "," : "") + JSON.stringify({ id: `measurement-image-${i}`, type: "image/png", size: bytes.length, width, height, createdAt: at, data: bytes.toString("base64") }));
  }
  writeSync(fd, "]}\n");
} finally { closeSync(fd); }
console.log(path);
