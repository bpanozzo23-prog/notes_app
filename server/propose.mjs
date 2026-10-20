import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { isEntryPoint, keyFor, stableStringify } from "./fsutil.mjs";
import { MAX_JSON_BYTES, MAX_PROPOSAL_BYTES, isSafeId } from "./constants.mjs";
import { MAX_BODY_BYTES, PENDING_NAME, proposalHash, proposalProblem, referenceProblem } from "./proposals.mjs";
import { readViewFile, withDirectory, writeInDirectory, unlinkInDirectory, readRegular, refuse } from "./view-fs.mjs";

const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const jsonFile = async (root, name, limit = 64 * 1024 * 1024) => JSON.parse(decode(await readViewFile(root, name, limit)));
const json = (value) => `${stableStringify(value)}\n`;
const USAGE = "Usage: ./propose draft <note-id> [--force] | check <note-id> | submit <note-id> | list | withdraw <pid>";
const MESSAGES = {
  "unknown-note": "Unknown note; use an id from notebook/index.json.",
  "draft-exists": "Draft exists; edit it or use draft <note-id> --force to replace it.",
  "moved-rev": "Note changed; draft again from the current view.",
  "note-busy": "A proposal for this note is pending; wait for its outcome or withdraw it.",
  "invalid-shape": "Use only the draft fields; do not add or remove fields.",
  "invalid-title": "Title must be at most 200 characters without control characters.",
  "invalid-tags": "Use at most 50 trimmed, unique tags without controls, each 1–512 characters.",
  "invalid-why": "Reason must be a string of at most 300 characters.",
  "invalid-body": "Body must be HTML text of at most 512 KB.",
  "too-large": "File is too large; body limit is 512 KB and proposal limit is 1 MB.",
  "unknown-folder": "Choose a folder id from notebook/folders.json or null.",
  "unknown-note-link": "Link only to note ids in notebook/index.json.",
  "new-image": "Use only image ids already in this note.",
  "unsafe-directory": "A directory is unsafe; it must be a real directory owned by you.",
  "not-regular": "Expected a regular file, not a symlink or special file.",
};
async function notebook(root) {
  const index = await jsonFile(root, "notebook/index.json");
  if (!Array.isArray(index.notes)) refuse("invalid-index");
  return { index, folders: await jsonFile(root, "notebook/folders.json"),
    proposals: await jsonFile(root, "notebook/proposals.json") };
}
async function pendingFiles(root) {
  return withDirectory(root, "inbox/pending", async ({ directory }) => {
    const result = [];
    for (const name of (await fs.readdir(directory)).sort()) {
      if (!PENDING_NAME.test(name)) continue;
      // Fail closed on uninspectable files; never silently allow a duplicate proposal.
      const value = JSON.parse(decode(await readRegular(path.join(directory, name), MAX_PROPOSAL_BYTES)));
      result.push({ name, value });
    }
    return result;
  });
}
async function removeDraft(root, relative) {
  await withDirectory(root, relative, async (dir) => {
    for (const name of ["body.html", "proposal.json"]) await unlinkInDirectory(dir, name);
  });
  await withDirectory(root, "inbox/drafts", async (dir) => {
    await dir.verify();
    // rmdir removes only an empty directory and never traverses leftover files or links.
    await fs.rmdir(path.join(dir.directory, path.basename(relative)));
    await dir.sync();
  });
}
export async function propose(args = process.argv.slice(2), {
  viewDir = process.env.NOTES_VIEW ?? process.cwd(), print = (s) => process.stdout.write(`${s}\n`),
  now = () => Date.now(), random = () => randomBytes(8).toString("hex"),
} = {}) {
  const [command, id, option, ...rest] = args;
  const valid = command === "list" ? args.length === 1 :
    ["draft", "check", "submit", "withdraw"].includes(command) && typeof id === "string" &&
    !rest.length && (option === undefined || command === "draft" && option === "--force");
  if (!valid) { print(USAGE); return 2; }
  try {
    const root = path.resolve(viewDir);
    if (command === "withdraw") {
      if (!PENDING_NAME.test(`${id}.json`)) refuse("invalid-proposal-id");
      await withDirectory(root, "inbox/pending", (dir) => unlinkInDirectory(dir, `${id}.json`));
      print(`Withdrawn ${id}.`); return 0;
    }
    const { index, folders, proposals } = await notebook(root);
    if (command === "list") {
      for (const { name, value } of await pendingFiles(root)) {
        const known = proposals.find((p) => p.proposal === name.slice(0, -5) && p.hash === proposalHash(value));
        // A changed, not-yet-ingested file is deliberately kept.
        if (known && known.status !== "pending") await withDirectory(root, "inbox/pending", (dir) => unlinkInDirectory(dir, name));
      }
      const shown = [...proposals.filter((p) => p.status === "pending"), ...proposals.filter((p) => p.status !== "pending").slice(-20)];
      for (const p of shown) print(JSON.stringify({ proposal: p.proposal, hash: p.hash, note: p.note,
        status: p.status, outcome: p.outcome ?? null }));
      if (!shown.length) print("No proposals recorded yet.");
      return 0;
    }
    if (!isSafeId(id)) refuse("unknown-note");
    const note = index.notes.find((n) => n.id === id);
    if (!note || note.file !== keyFor(id)) refuse("unknown-note");
    const relative = `inbox/drafts/${keyFor(id)}`;
    if (command === "draft") {
      // Preserve an existing large note exactly; check/submit enforce the proposed-body cap.
      const body = await readViewFile(root, `notebook/notes/${keyFor(id)}.html`, MAX_JSON_BYTES);
      const metadata = { note: id, basedOnRev: note.rev, generation: index.generation,
        title: note.title, folderId: note.folderId, tags: note.tags, why: "" };
      await withDirectory(root, "inbox/drafts", async (dir) => {
        await dir.verify();
        try { await fs.mkdir(path.join(dir.directory, keyFor(id)), { mode: 0o755 }); }
        catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (option !== "--force") refuse("draft-exists");
        }
        await dir.sync();
      });
      await withDirectory(root, relative, async (dir) => {
        await writeInDirectory(dir, "body.html", body);
        await writeInDirectory(dir, "proposal.json", json(metadata));
      });
      print(`Draft ready: ${relative}/body.html and proposal.json.`); return 0;
    }
    const metadata = await jsonFile(root, `${relative}/proposal.json`, MAX_PROPOSAL_BYTES);
    const body = decode(await readViewFile(root, `${relative}/body.html`, MAX_BODY_BYTES));
    const value = { ...metadata, body };
    if (Object.hasOwn(metadata, "body") || Object.hasOwn(metadata, "proposal") || metadata.note !== id) refuse("invalid-shape");
    const problem = proposalProblem(value) ?? referenceProblem(value, index, folders);
    if (problem) refuse(problem);
    if (command === "check") { print("OK: shape, references and size; the phone will review formatting."); return 0; }
    // Re-read the view immediately before publication, after reading the draft.
    const current = await notebook(root);
    const latest = current.index.notes.find((n) => n.id === id);
    if (!latest || latest.rev !== value.basedOnRev || current.index.generation !== value.generation) refuse("moved-rev");
    const reference = referenceProblem(value, current.index, current.folders);
    if (reference) refuse(reference);
    if (current.proposals.some((p) => p.note === id && p.status === "pending")) refuse("note-busy");
    for (const { name, value: local } of await pendingFiles(root)) {
      const known = current.proposals.find((p) => p.proposal === name.slice(0, -5) && p.hash === proposalHash(local));
      if (local.note === id && (!known || known.status === "pending")) refuse("note-busy");
    }
    const proposal = `p-${Number(now()).toString(36)}-${random()}`;
    if (!PENDING_NAME.test(`${proposal}.json`)) refuse("invalid-proposal-id");
    const submission = { ...value, proposal };
    const submissionProblem = proposalProblem(submission, proposal);
    if (submissionProblem) refuse(submissionProblem);
    await withDirectory(root, "inbox/pending", async (dir) => {
      // Random ids must not accidentally overwrite an existing submission.
      try { await fs.lstat(path.join(dir.directory, `${proposal}.json`)); refuse("proposal-exists"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await writeInDirectory(dir, `${proposal}.json`, json(submission));
    });
    try { await removeDraft(root, relative); }
    catch { print(`Submitted ${proposal}; draft cleanup incomplete; do not resubmit.`); return 0; }
    print(`Submitted ${proposal}; waiting for the owner's review.`); return 0;
  } catch (error) {
    const reason = error.reason;
    print(`Refused: ${MESSAGES[reason] ?? (reason ? `${reason}.` : error.code === "ENOENT" ?
      "Missing view or draft; sync, then run draft <note-id>." : "Unreadable or invalid file; check the view and draft.")}`);
    return 1;
  }
}
if (isEntryPoint(import.meta.url)) {
  process.exitCode = await propose();
}
