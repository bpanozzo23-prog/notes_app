import { CLAUDE_MODEL, QUESTION_EFFORT, QUESTION_MAX_TOKENS, priceUsage } from "./config.js";
import { ASK_SYSTEM_PROMPT } from "./prompts.js";
import { buildDocuments, payloadIsLive, deepFreeze } from "./payload.js";
import { streamMessage, toClaudeError, RESPONSE_ERRORS, ERROR_MESSAGES } from "./client.js";
import { claudeSession, canStartClaudeRequest } from "./session.js";
import { notebookAccess } from "../db/db.js";
import { addClaudeSpend } from "./prefs.js";

export const CONVERSATION_ENDED = "A note in this conversation was moved to Trash or deleted. Start a new question.";
export const MODEL_NAMES = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5", "claude-opus-5": "Opus 5", "claude-opus-4-8": "Opus 4.8" };
export const modelName = (model) => Object.hasOwn(MODEL_NAMES, model) ? MODEL_NAMES[model] : model;
export function formatMoney(dollars) {
  if (dollars < 0.01) return "under 1¢";
  if (dollars < 1) return `${Math.floor((dollars + Number.EPSILON) * 100 + 0.5)}¢`;
  return `$${(Math.floor((dollars + Number.EPSILON) * 100 + 0.5) / 100).toFixed(2)}`;
}
// "about under 1¢" reads badly; an estimate under a cent is just "under 1¢".
export const aboutMoney = (dollars) => dollars < 0.01 ? "under 1¢" : `about ${formatMoney(dollars)}`;
export function costLabel(turn) {
  const cost = turn.cost?.kind === "known" ? formatMoney(turn.cost.dollars) : turn.cost?.kind === "at-least" ? `at least ${formatMoney(turn.cost.dollars)}` : "cost unknown";
  return `${cost}${turn.model ? ` · ${turn.fallback ? "answered by " : ""}${modelName(turn.model)}` : ""}`;
}
// SDK 0.135.0 BetaContentBlockParam union. Unknown future blocks are not echoed.
const PARAM_TYPES = new Set(["image", "document", "search_result", "thinking", "redacted_thinking", "tool_use", "tool_result", "server_tool_use", "web_search_tool_result", "web_fetch_tool_result", "advisor_tool_result", "code_execution_tool_result", "bash_code_execution_tool_result", "text_editor_code_execution_tool_result", "tool_search_tool_result", "mcp_tool_use", "mcp_tool_result", "container_upload", "compaction", "tool_addition", "tool_removal", "mcp_tool_listing", "fallback"]);
const CITATION_FIELDS = {
  char_location: ["cited_text", "document_index", "document_title", "end_char_index", "start_char_index", "type"],
  page_location: ["cited_text", "document_index", "document_title", "end_page_number", "start_page_number", "type"],
  content_block_location: ["cited_text", "document_index", "document_title", "end_block_index", "start_block_index", "type"],
  search_result_location: ["cited_text", "end_block_index", "search_result_index", "source", "start_block_index", "title", "type"],
  web_search_result_location: ["cited_text", "encrypted_index", "title", "type", "url"],
};
export function assistantParams(content) {
  return content.flatMap((block) => {
    if (block.type !== "text") return PARAM_TYPES.has(block.type) ? [structuredClone(block)] : [];
    return [{ type: "text", text: block.text, ...(block.citations !== undefined ? { citations: block.citations === null ? null : block.citations.flatMap((citation) => {
      const fields = CITATION_FIELDS[citation.type];
      return fields ? [Object.fromEntries(fields.filter((key) => Object.hasOwn(citation, key)).map((key) => [key, citation[key]]))] : [];
    }) } : {}) }];
  });
}
export function buildAskRequest({ payload, images, turns = [], question, now = new Date() }) {
  const completed = turns.filter((turn) => turn.status === "completed");
  const first = turns[0];
  const date = new Date(first?.startedAt ?? now);
  const today = `${date.toLocaleDateString("en-GB", { weekday: "long" })} ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  const content = buildDocuments(payload);
  if (payload.scope.kind === "note") for (const image of (images?.images ?? [])) content.push({ type: "image", source: { type: "base64", media_type: image.type, data: image.data } });
  if (content.length) content.at(-1).cache_control = { type: "ephemeral" };
  content.push({ type: "text", text: `Today is ${today}.\n\n${first?.question ?? question}` });
  const messages = [{ role: "user", content }];
  for (const [index, turn] of completed.entries()) {
    messages.push({ role: "assistant", content: assistantParams(turn.assistantContent) });
    messages.push({ role: "user", content: [{ type: "text", text: completed[index + 1]?.question ?? question }] });
  }
  return { model: CLAUDE_MODEL, max_tokens: QUESTION_MAX_TOKENS, output_config: { effort: QUESTION_EFFORT },
    system: ASK_SYSTEM_PROMPT, cache_control: { type: "ephemeral" }, messages };
}
export function citationsToSources(content, payload) {
  const sources = [], stretches = [];
  for (const block of content) {
    if (block.type !== "text") continue;
    const numbers = [];
    for (const citation of block.citations ?? []) {
      if (!Number.isInteger(citation.document_index)) continue;
      const entry = payload.entries[citation.document_index];
      if (!entry) continue;
      let source = sources.find((item) => item.noteId === entry.noteId);
      if (!source) { source = { number: sources.length + 1, noteId: entry.noteId, title: entry.title, quotes: [] }; sources.push(source); }
      // Show the passage as the owner wrote it, without the projection's task and link markers.
      const quote = (citation.cited_text ?? "").replace(/\[(?: |x)\] /g, "").replace(/ \[→ [^\]]*\]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (quote && !source.quotes.includes(quote)) source.quotes.push(quote);
      if (!numbers.includes(source.number)) numbers.push(source.number);
    }
    stretches.push({ text: block.text, numbers });
  }
  return { sources, stretches };
}
function displayContent(content, payload) {
  const { sources, stretches } = citationsToSources(content, payload);
  return { display: { text: stretches.map((stretch) => stretch.text).join(""), citations: stretches }, sources };
}
export async function runAsk({ payload, images = null, question, retry = false, now = new Date(), session = claudeSession, access = notebookAccess, fetch, maxRetries }) {
  if (!question.trim()) return;
  const existing = session.getSnapshot().conversation;
  if (existing?.ended || (!retry && existing?.turns.length >= 11)) return;
  if (existing && !retry && existing.turns[0]?.status !== "completed") return;
  if (retry && (!existing || existing.turns.at(-1)?.status === "completed")) return;
  payload = existing?.payload ?? payload; images = existing?.images ?? images;
  if (!payload) return;
  const request = session.beginRequest("ask");
  if (!request) return;
  const { token, signal } = request;
  let conversation = existing ?? { scope: payload.scope, payload, images, firstQuestionAt: new Date(now).toISOString(), turns: [] };
  let index;
  const update = (patch) => {
    if (!session.isCurrent(token)) return;
    conversation = { ...conversation, turns: conversation.turns.map((turn, i) => i === index ? { ...turn, ...patch } : turn) };
    session.setConversation(token, conversation);
  };
  try {
    if (!(await payloadIsLive(payload))) {
      if (!session.isCurrent(token)) return;
      if (!existing) return { refused: true };
      session.setConversation(token, { ...conversation, ended: CONVERSATION_ENDED });
      return;
    }
    if (!session.isCurrent(token)) return;
    const turns = retry ? conversation.turns.slice(0, -1) : conversation.turns;
    if (retry) question = conversation.turns.at(-1).question;
    // Anchor the first message to its original date, including a retry after midnight.
    const protocol = buildAskRequest({ payload, images, turns: retry && !turns.length ? [{ ...conversation.turns[0], status: "failed" }] : turns, question, now: conversation.firstQuestionAt });
    index = turns.length;
    conversation = { ...conversation, turns: [...turns, { question, startedAt: new Date(now).toISOString(), status: "running", display: { text: "", citations: [] }, sources: [], cost: { kind: "unknown" } }] };
    // Store the first request's date separately from attempt timing used for estimates.
    conversation.firstMessage = conversation.firstMessage ?? protocol.messages[0];
    protocol.messages[0] = conversation.firstMessage;
    session.setConversation(token, conversation);
    const response = await streamMessage(protocol, { fetch, maxRetries, signal, onEvent(event, message) {
      if (!session.isCurrent(token)) return;
      if (event.type === "message_start") {
        const usage = structuredClone(event.message.usage), model = event.message.model;
        const dollars = priceUsage(model, { input_tokens: usage.input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: usage.cache_read_input_tokens ?? 0, output_tokens: 0 });
        update({ model, usage, cost: dollars === null ? { kind: "unknown" } : { kind: "at-least", dollars } });
      }
      if (event.type.startsWith("content_block")) update(displayContent(message.content, payload));
    } });
    if (!session.isCurrent(token)) return;
    // A refusal may contain no content at all. Check it before inspecting content.
    if (response.stop_reason === "refusal") {
      update({ status: "refused", display: { text: RESPONSE_ERRORS.refusal, citations: [] }, sources: [], error: { kind: "refusal", message: RESPONSE_ERRORS.refusal }, cost: { kind: "unknown" }, model: response.model });
      return;
    }
    const status = response.stop_reason === "end_turn" ? "completed" : response.stop_reason === "max_tokens" ? "cut" : "failed";
    const dollars = priceUsage(response.model, response.usage);
    update({ status, ...displayContent(response.content, payload), model: response.model,
      fallback: response.usage.iterations?.some((iteration) => iteration.type === "fallback_message") || response.content.some((block) => block.type === "fallback"),
      usage: structuredClone(response.usage), cost: dollars === null ? { kind: "unknown" } : { kind: "known", dollars },
      ...(status === "completed" ? { assistantContent: deepFreeze(structuredClone(response.content)) } : {}),
      ...(status === "failed" ? { error: { kind: "unknown", message: ERROR_MESSAGES.unknown } } : {}),
    });
    if (["completed", "cut"].includes(status) && dollars !== null && session.isCurrent(token) && canStartClaudeRequest(access.getSnapshot())) {
      // Bookkeeping failure must not turn a received answer into a failed request.
      await addClaudeSpend(response.id, dollars).catch(() => {});
    }
  } catch (error) {
    const mapped = toClaudeError(error);
    update({ status: mapped.kind === "cancelled" ? "stopped" : mapped.kind === "network" ? "lost" : "failed", error: mapped });
  } finally { session.endRequest(token); }
}
