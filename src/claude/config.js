export const CLAUDE_MODEL = "claude-opus-5-5";
export const QUESTION_EFFORT = "medium";
export const PROPOSAL_EFFORT = "high";
export const QUESTION_MAX_TOKENS = 16000;
export const PROPOSAL_MAX_TOKENS = 32000;
export const USE_REFUSAL_FALLBACK = true;
export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const REFUSAL_FALLBACKS = "default";
export const MAX_RETRIES = 2;
export const SPEND_LIMIT_URL = "https://platform.claude.com/settings/billing";
// US dollars per million tokens; prices checked 2026-10-18.
// Each row: input, 5-minute cache write, cache read, output.
export const PRICES = Object.freeze({
  "claude-opus-5-5": [4, 5, 0.20, 20],
  "claude-sonnet-5-5": [2, 2.50, 0.10, 10],
  "claude-haiku-5-5": [0.10, 0.125, 0.01, 0.50],
  "claude-opus-5": [5, 6.25, 0.50, 25],
  "claude-opus-4-8": [5, 6.25, 0.50, 25],
});
export function priceUsage(model, usage) {
  if (!Object.hasOwn(PRICES, model)) return null;
  const counts = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"].map((key) => usage?.[key]);
  if (!counts.every((count) => Number.isFinite(count) && count >= 0)) return null;
  return counts.reduce((total, count, index) => total + count * PRICES[model][index], 0) / 1000000;
}
