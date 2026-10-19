import { captureReorganisePayload } from "./reorganise.js";
import { deepFreeze } from "./payload.js";
import { shape, runProposal } from "./proposals.js";
import { DUPLICATES_SYSTEM_PROMPT } from "./prompts.js";
import { CLAUDE_MODEL, PROPOSAL_EFFORT, PROPOSAL_MAX_TOKENS } from "./config.js";
import { RESPONSE_ERRORS } from "./client.js";

export const DUPLICATES_TASK = "Find notes in this notebook that duplicate each other.";
const groupProperties = { notes: { type: "array", items: { type: "string" } }, reason: { type: "string" } };
export const DUPLICATES_SCHEMA = { type: "object", properties: { summary: { type: "string" }, groups: { type: "array", items: {
  type: "object", properties: groupProperties, required: Object.keys(groupProperties), additionalProperties: false,
} } }, required: ["summary", "groups"], additionalProperties: false };
export async function captureDuplicatesPayload() {
  const captured = await captureReorganisePayload();
  const notes = captured.notes.map(({ id, rev, title, displayTitle, folderId, tags, text, handle }) => ({ id, rev, title, displayTitle, folderId, tags, text, handle }));
  const requestText = JSON.stringify({ task: DUPLICATES_TASK, notes: notes.map((note) => ({ handle: note.handle, title: note.displayTitle,
    folder: captured.folders.find((folder) => folder.id === note.folderId)?.name ?? null, tags: note.tags, text: note.text })) });
  return deepFreeze({ kind: "duplicates", generation: captured.generation, capturedAt: captured.capturedAt, notes, requestText, system: DUPLICATES_SYSTEM_PROMPT });
}
export function buildDuplicatesRequest(payload) {
  return { model: CLAUDE_MODEL, max_tokens: PROPOSAL_MAX_TOKENS, output_config: { effort: PROPOSAL_EFFORT, format: { type: "json_schema", schema: DUPLICATES_SCHEMA } }, system: payload.system, messages: [{ role: "user", content: payload.requestText }] };
}
export function validateDuplicatesProposal(raw, payload) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    if (!shape(value, DUPLICATES_SCHEMA) || value.groups.length > 10) throw new Error();
    const handles = new Set(payload.notes.map((note) => note.handle)), used = new Set();
    if (value.groups.some((group) => group.notes.some((handle) => !handles.has(handle)))) throw new Error();
    value.groups = value.groups.flatMap((group) => {
      const notes = [...new Set(group.notes)].filter((handle) => !used.has(handle));
      if (notes.length < 2) return []; // A dropped group doesn't claim its one note.
      for (const handle of notes) used.add(handle);
      return [{ ...group, notes }];
    });
    value.noChanges = !value.groups.length;
    return deepFreeze(value);
  } catch { throw new Error(RESPONSE_ERRORS.invalid); }
}
export const duplicatesItemIds = (proposal) => proposal.groups.flatMap((group, index) => group.notes.slice(0, 5).map((handle) => `g${index + 1}:${handle}`));
export const runDuplicates = (options) => runProposal({ ...options, buildRequest: buildDuplicatesRequest, validate: validateDuplicatesProposal });
