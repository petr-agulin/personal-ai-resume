// Talks to the site Worker: /api/session (bot check → 30-minute pass), then
// /api/chat and /api/fit with that pass. Under `npm run dev` there is no
// Worker (only Astro's preview), so the panel gets a fixed sample reply and a
// sample fit result instead. `npm run dev:ai` and the live site use the real AI.

import { getToken } from "./turnstile.ts";
import type { ChatMessage, FitResult, PanelConfig } from "./types.ts";

export type ApiCode =
  | "busy"
  | "too_large"
  | "too_fast"
  | "resting"
  | "not_verified"
  | "no_pass"
  | "not_job_ad"
  | "failed";
const KNOWN: ApiCode[] = ["busy", "too_large", "too_fast", "resting", "not_verified", "no_pass", "not_job_ad"];

/** busy: the AI's per-minute limit (retryAfter: seconds, when known). too_large: the
 *  request is bigger than the AI plan takes at once, so waiting won't help. too_fast:
 *  this visitor's speed limit. resting: today's total for the site is used up.
 *  not_verified: the bot check failed. no_pass: the pass expired or is missing.
 *  not_job_ad: the job-fit text isn't a job ad. failed: anything else. */
export class ApiError extends Error {
  readonly code: ApiCode;
  readonly retryAfter?: number;
  constructor(code: ApiCode, retryAfter?: number) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function askChat(config: PanelConfig, messages: ChatMessage[]): Promise<string> {
  if (import.meta.env.DEV) {
    await wait(900);
    return config.strings.sampleReply;
  }
  const data = await withPass<{ reply?: unknown }>(config, "/api/chat", {
    lang: config.lang,
    messages: messages.map(({ role, text }) => ({ role, text })),
  });
  if (typeof data.reply !== "string" || !data.reply.trim()) throw new ApiError("failed");
  return data.reply;
}

export async function analyzeFit(config: PanelConfig, jobAd: string): Promise<FitResult> {
  if (import.meta.env.DEV) {
    await wait(1600);
    return SAMPLE_FIT;
  }
  const data = await withPass<{ fit?: FitResult }>(config, "/api/fit", { lang: config.lang, jobAd });
  if (!data.fit || typeof data.fit.score !== "number") throw new ApiError("failed");
  return data.fit;
}

/** Starts the bot check in the background when the panel opens, so the pass
 *  is usually ready before the first question. */
export function warmUp(config: PanelConfig): void {
  if (import.meta.env.DEV) return;
  ensurePass(config).catch(() => {}); // a failure shows up on the first question
}

// ------------------------------------------------------------------- the pass

const PASS_KEY = "ai-pass";
/** Renew a pass this long before it expires. */
const RENEW_MS = 60_000;
let renewing: Promise<string> | null = null;

async function ensurePass(config: PanelConfig, fresh = false): Promise<string> {
  if (!fresh) {
    const saved = readPass();
    if (saved && saved.expiresAt - Date.now() > RENEW_MS) return saved.pass;
  }
  renewing ??= (async () => {
    const container = document.querySelector<HTMLElement>(".ai-turnstile");
    let token: string;
    try {
      token = await getToken(config.turnstileSiteKey, config.lang, container ?? document.body);
    } catch {
      throw new ApiError("not_verified");
    }
    const data = await post<{ pass?: string; expiresAt?: number }>("/api/session", { token });
    if (typeof data.pass !== "string" || typeof data.expiresAt !== "number") throw new ApiError("failed");
    savePass(data.pass, data.expiresAt);
    return data.pass;
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

/** Calls the API with the pass; if the server says it's expired, renews it once. */
async function withPass<T>(config: PanelConfig, path: string, body: unknown): Promise<T> {
  try {
    return await post<T>(path, body, await ensurePass(config));
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "no_pass") throw err;
    return await post<T>(path, body, await ensurePass(config, true));
  }
}

// The pass is kept for this browser tab only. It holds no personal data.
function readPass(): { pass: string; expiresAt: number } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PASS_KEY) ?? "null");
    return typeof saved?.pass === "string" && typeof saved?.expiresAt === "number" ? saved : null;
  } catch {
    return null;
  }
}

function savePass(pass: string, expiresAt: number) {
  try {
    sessionStorage.setItem(PASS_KEY, JSON.stringify({ pass, expiresAt }));
  } catch {
    // Without storage the pass simply isn't remembered between page loads.
  }
}

// ---------------------------------------------------------------------- fetch

async function post<T>(path: string, body: unknown, pass?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(pass && { "x-ai-pass": pass }) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("failed"); // offline or the server didn't answer
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; retryAfter?: unknown }) | null;
  if (res.ok && data) return data;
  const code = KNOWN.find((c) => c === data?.error) ?? (res.status === 429 ? "busy" : "failed");
  const seconds = Number(data?.retryAfter ?? res.headers.get("retry-after"));
  throw new ApiError(code, Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SAMPLE_FIT: FitResult = {
  score: 78,
  label: "good",
  summary: "Sample result: this preview has no AI. Run npm run dev:ai to analyze a real job ad.",
  strengths: [
    { title: "Product strategy", detail: "Sample: owning a roadmap end to end, as the ad asks for." },
    { title: "Discovery and research", detail: "Sample: regular customer interviews and decisions backed by data." },
    { title: "Cross-team alignment", detail: "Sample: getting several teams behind shared priorities." },
  ],
  gaps: [
    {
      title: "Domain depth",
      detail: "Sample: the industry in the ad may be new to me; I would close that gap with early customer interviews.",
    },
  ],
  highlights: [
    { role: "Most recent role", point: "Sample: a relevant achievement, ideally with a number." },
    { role: "Earlier role", point: "Sample: another achievement that matches the ad." },
  ],
};
