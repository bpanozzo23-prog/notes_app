// Made-up responses only. No owner's notes or credentials.
export const countTokens = { input_tokens: 8 };
const body = (type, message, details) => ({ type: "error", error: { type, message, ...(details ? { details } : {}) } });
export const httpErrors = [
  { status: 401, kind: "auth", body: body("authentication_error", "Fixture key rejected") },
  { status: 402, kind: "billing", body: body("billing_error", "Fixture billing issue") },
  { status: 403, kind: "auth", body: body("permission_error", "Fixture permission denied") },
  { status: 429, kind: "rate", body: body("rate_limit_error", "Fixture rate limit") },
  { status: 429, kind: "spend_limit", body: body("rate_limit_error", "Fixture monthly cap", { error_code: "enforced_spend_limit_reached" }) },
  { status: 400, kind: "spend_limit", body: body("invalid_request_error", "You have reached your specified API usage limits.") },
  { status: 400, kind: "request", body: body("invalid_request_error", "Fixture bad request") },
  { status: 413, kind: "request", body: body("invalid_request_error", "Fixture too large") },
  { status: 500, kind: "overloaded", body: body("api_error", "Fixture server error") },
  { status: 529, kind: "overloaded", body: body("overloaded_error", "Fixture busy") },
];
export const citation = { type: "char_location", cited_text: "Café opens on Sunday.", document_index: 0,
  document_title: "Made-up café", start_char_index: 0, end_char_index: 21, file_id: null };
export const answerEvents = [
  { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: [] } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Café " } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "opens on Sunday." } },
  { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 9 } },
  { type: "message_stop" },
];
export const streamError = { type: "error", error: { type: "overloaded_error", message: "Made-up mid-stream failure" } };
export const sseFrames = (events = answerEvents) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
