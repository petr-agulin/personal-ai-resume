// What the site Worker gets from Cloudflare: bindings and vars from
// wrangler.jsonc, and secrets set with `wrangler secret put` (or .dev.vars locally).

export interface Env {
  ASSETS: Fetcher;
  /** Workers AI, for searching the hidden notes. */
  AI: Ai;
  /** D1 database "resume-log": the visitor log, also used for the daily totals. */
  DB: D1Database;
  /** Per-visitor speed limits (Workers Rate Limiting). */
  CHAT_LIMITER: RateLimit;
  FIT_LIMITER: RateLimit;
  /** Vars in wrangler.jsonc: the AI provider's chat completions address, and the model. */
  AI_API_URL: string;
  AI_MODEL: string;
  /** Vars in wrangler.jsonc: daily totals for the whole site. */
  DAILY_CAP_CHAT: string;
  DAILY_CAP_FIT: string;
  /** Var in wrangler.jsonc: the most a single AI request may send, in tokens. */
  MAX_PROMPT_TOKENS: string;
  /** Secret: the Groq API key. */
  AI_API_KEY?: string;
  /** Secret: Turnstile secret key (a Cloudflare test key locally). */
  TURNSTILE_SECRET?: string;
  /** Secret: any long random string; signs the 30-minute pass. */
  PASS_SIGNING_KEY?: string;
}
