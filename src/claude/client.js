import { readClaudeKey } from "./prefs.js";
import { CLAUDE_MODEL, MAX_RETRIES, USE_REFUSAL_FALLBACK, REFUSAL_FALLBACK_BETA, REFUSAL_FALLBACKS } from "./config.js";

let sdkPromise, sdk;
export function loadClaudeSdk() {
  return sdkPromise ??= import("@anthropic-ai/sdk").then((module) => (sdk = module)).catch((error) => {
    sdkPromise = undefined; // A failed preload can be retried when the owner opens Settings.
    throw error;
  });
}
export async function createClaudeClient({ fetch = (...args) => globalThis.fetch(...args), maxRetries = MAX_RETRIES } = {}) {
  const [module, apiKey] = await Promise.all([loadClaudeSdk(), readClaudeKey()]);
  return new module.default({ apiKey, dangerouslyAllowBrowser: true, maxRetries, fetch, logLevel: "off" });
}
export const RESPONSE_ERRORS = Object.freeze({
  refusal: "Claude declined to answer this.",
  truncated: "The proposal was cut short; nothing was changed.",
  invalid: "Claude's proposal couldn't be used; nothing was changed.",
});
export const ERROR_MESSAGES = Object.freeze({
  cancelled: "Stopped.",
  network: "Couldn't reach Anthropic. Check your connection and try again.",
  auth: "Anthropic rejected the API key. Check it in Settings → Claude.",
  spend_limit: "Your Anthropic spend limit has been reached. Raise it in the console, or wait for next month.",
  billing: "Anthropic reports a billing problem with your account.",
  rate: "Too many requests just now. Try again in a minute.",
  overloaded: "Anthropic is busy. Try again shortly.",
  unknown: "Something went wrong talking to Anthropic.",
  ...RESPONSE_ERRORS,
});
export function toClaudeError(error) {
  const is = (name) => sdk?.[name] && error instanceof sdk[name];
  const body = error?.error?.error ?? error?.error;
  const status = error?.status;
  const type = typeof body?.type === "string" && /^[a-z_]+$/.test(body.type) ? body.type : undefined;
  let kind = "unknown";
  if (is("APIUserAbortError") || error?.name === "AbortError") kind = "cancelled";
  else if (is("APIConnectionError") || error instanceof TypeError) kind = "network";
  else if (status === 401 || status === 403) kind = "auth";
  else if ((status === 400 && typeof body?.message === "string" && body.message.includes("specified API usage limits")) ||
    (status === 429 && (body?.details ?? error?.error?.details)?.error_code === "enforced_spend_limit_reached")) kind = "spend_limit";
  else if (status === 402) kind = "billing";
  else if (status === 429) kind = "rate";
  else if (status >= 500 && status <= 599) kind = "overloaded";
  else if (status >= 400 && status <= 499) kind = "request";
  // SSE errors have no HTTP status (the response headers already said 200).
  else if (is("APIError") && ["overloaded_error", "api_error"].includes(type)) kind = "overloaded";
  const message = kind === "request" ? `Anthropic couldn't accept this request${type ? ` (${type})` : ""}.` : ERROR_MESSAGES[kind];
  return { kind, message, ...(type ? { type } : {}),
    ...(typeof error?.requestID === "string" && /^req_[a-zA-Z0-9_-]+$/.test(error.requestID) ? { requestId: error.requestID } : {}) };
}
export async function testClaudeKey({ fetch, signal, maxRetries } = {}) {
  try {
    const client = await createClaudeClient({ fetch, maxRetries });
    await client.messages.countTokens({ model: CLAUDE_MODEL, messages: [{ role: "user", content: "Hi" }] }, { signal });
    return { result: "works" };
  } catch (error) {
    const mapped = toClaudeError(error);
    return mapped.kind === "auth" ? { result: "rejected" } : { result: "unknown", message: `Couldn't check the key: ${mapped.message}` };
  }
}
export async function streamMessage(params, { fetch, signal, onEvent, maxRetries } = {}) {
  const client = await createClaudeClient({ fetch, maxRetries });
  const body = { ...params };
  for (const key of ["thinking", "temperature", "top_p", "budget_tokens"]) delete body[key];
  if (USE_REFUSAL_FALLBACK) {
    body.betas = [...new Set([...(body.betas ?? []), REFUSAL_FALLBACK_BETA])];
    body.fallbacks = REFUSAL_FALLBACKS;
  }
  const stream = client.beta.messages.stream(body, { signal });
  if (onEvent) stream.on("streamEvent", onEvent);
  return stream.finalMessage();
}
