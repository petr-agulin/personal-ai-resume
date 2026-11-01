// Site Worker. Cloudflare serves the built pages in dist/ directly; this code
// only runs for /api/* (wrangler.jsonc, "run_worker_first").
//   POST /api/session {token}                         →  {pass, expiresAt}
//   POST /api/chat    {lang, messages: [{role, text}]} →  {reply}
//   POST /api/fit     {lang, jobAd}                    →  {fit}
// Chat and fit need the pass (header x-ai-pass) that /api/session gives after
// the Turnstile bot check. Errors come back as {error: code}; the panel shows
// a friendly message in the page language. Upstream details go to the log
// (an "error" row in D1, SPEC §9), never to the browser.

import { z } from "zod";
import { AiError, complete } from "./ai.ts";
import type { Env } from "./env.ts";
import { analyzeFit, NotJobAdError } from "./fit.ts";
import { checkOrigin, checkPass, checkRate, issuePass, readBody, Refusal, verifyTurnstile } from "./guard.ts";
import { countToday, logEntry, type Entry, type Kind } from "./log.ts";
import { chatSystemPrompt, FIT_SCHEMA, fitSystemPrompt, fitUserMessage } from "./prompts.ts";
import { estimateTokens, findNotes, notesMessage, notesWithin, type Note } from "./search.ts";

/** Input limits (SPEC §7); the panel enforces the same. */
const LIMITS = { history: 10, message: 2000, question: 500, jobAdMin: 40, jobAdMax: 6000 };

const Lang = z.enum(["en", "sv"]);
const ChatRequest = z.object({
  lang: Lang,
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })).min(1),
});
const FitRequest = z.object({ lang: Lang, jobAd: z.string() });
const SessionRequest = z.object({ token: z.string() });

/** Per request: the page language once known, and a way to log a server problem. */
interface Meta {
  lang: string | null;
  logError: (text: string) => void;
}

type Route = (request: Request, env: Env, meta: Meta) => Promise<Response>;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    const route = ROUTES[pathname];
    if (route) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const meta: Meta = {
        lang: null,
        // e.g. "chat: Groq 404: model not found". Written after the response is sent.
        logError: (text) =>
          ctx.waitUntil(safeLog(env, { kind: "error", lang: meta.lang, text: `${pathname.slice(5)}: ${text}`.slice(0, 300) })),
      };
      try {
        checkOrigin(request);
        return await route(request, env, meta);
      } catch (err) {
        return failure(err, meta);
      }
    }
    if (pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

const ROUTES: Record<string, Route> = {
  "/api/session": session,
  "/api/chat": chat,
  "/api/fit": fit,
};

/** After the bot check: a pass for the next 30 minutes. */
async function session(request: Request, env: Env): Promise<Response> {
  const parsed = SessionRequest.safeParse(await readBody(request));
  if (!parsed.success) throw new Refusal(400, "invalid");
  await verifyTurnstile(env, request, parsed.data.token);
  return json(await issuePass(env));
}

async function chat(request: Request, env: Env, meta: Meta): Promise<Response> {
  const body = await readBody(request);
  await checkPass(env, request);
  const parsed = ChatRequest.safeParse(body);
  if (!parsed.success) throw new Refusal(400, "invalid");
  const { lang, messages } = parsed.data;
  meta.lang = lang;
  const latest = messages[messages.length - 1];
  if (latest.role !== "user" || !latest.text.trim()) throw new Refusal(400, "invalid");
  if (
    messages.length > LIMITS.history ||
    latest.text.length > LIMITS.question ||
    messages.some((m) => m.text.length > LIMITS.message)
  ) {
    throw new Refusal(413, "too_long");
  }
  await checkRate(env.CHAT_LIMITER, request);
  await checkDailyCap(env, "chat");

  // Search the notes with the latest question plus the one before it, so a
  // follow-up like "tell me more about that" still finds the right topic.
  const query = messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.text)
    .join("\n");
  const system = chatSystemPrompt();
  const found = await safeFindNotes(env, query, 4, meta);
  const reply = await complete(env, {
    system,
    extraSystem: notesMessage(notesWithin(found, notesBudget(env, system, ...messages.map((m) => m.text)))),
    messages: messages.map((m) => ({ role: m.role, content: m.text })),
    maxTokens: 1000,
    // Low randomness: answers stick to the CONTEXT instead of filling gaps with typical details.
    temperature: 0.3,
  });
  await safeLog(env, { kind: "chat", lang, text: latest.text.trim() });
  return json({ reply });
}

async function fit(request: Request, env: Env, meta: Meta): Promise<Response> {
  const body = await readBody(request);
  await checkPass(env, request);
  const parsed = FitRequest.safeParse(body);
  if (!parsed.success) throw new Refusal(400, "invalid");
  const { lang } = parsed.data;
  meta.lang = lang;
  const jobAd = parsed.data.jobAd.trim();
  if (jobAd.length < LIMITS.jobAdMin) throw new Refusal(400, "invalid");
  if (jobAd.length > LIMITS.jobAdMax) throw new Refusal(413, "too_long");
  await checkRate(env.FIT_LIMITER, request);
  await checkDailyCap(env, "fit");

  // A job ad covers many requirements, so the search may pick a few more topics,
  // as many as fit next to the ad.
  const found = await safeFindNotes(env, jobAd, 6, meta);
  const notes = notesWithin(
    found,
    notesBudget(env, fitSystemPrompt(), fitUserMessage(jobAd), JSON.stringify(FIT_SCHEMA)),
  );
  const result = await analyzeFit(env, jobAd, notes);
  await safeLog(env, {
    kind: "fit",
    lang,
    text: jobAd,
    score: result.score,
    label: result.label,
    role: result.role,
    company: result.company,
  });
  // role and company are for the admin page only, not sent to the browser.
  const { role: _role, company: _company, ...visible } = result;
  return json({ fit: visible });
}

/** The friendly "resting" message once today's total for the whole site is reached. */
async function checkDailyCap(env: Env, kind: Kind): Promise<void> {
  const cap = Number(kind === "chat" ? env.DAILY_CAP_CHAT : env.DAILY_CAP_FIT);
  let used: number;
  try {
    used = await countToday(env, kind);
  } catch (err) {
    // If the log can't be read, answer anyway; Groq's own limits still apply.
    console.error("Daily cap check failed:", err instanceof Error ? err.message : String(err));
    return;
  }
  if (Number.isFinite(cap) && used >= cap) throw new Refusal(503, "resting");
}

/** A failed log write shouldn't cost the visitor their answer. */
async function safeLog(env: Env, entry: Entry): Promise<void> {
  try {
    await logEntry(env, entry);
  } catch (err) {
    console.error("Log write failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Tokens left for the notes once everything else in the request is counted. */
function notesBudget(env: Env, ...parts: string[]): number {
  const max = Number(env.MAX_PROMPT_TOKENS) || 7000;
  return max - parts.reduce((sum, part) => sum + estimateTokens(part), 0);
}

/** If the notes search fails, answer from the page content alone rather than not at all. */
async function safeFindNotes(env: Env, query: string, max: number, meta: Meta): Promise<Note[]> {
  try {
    return await findNotes(env, query, max);
  } catch (err) {
    const text = `Notes search failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(text);
    meta.logError(text);
    return [];
  }
}

/** Turns an error into the response the browser gets, and logs server problems. */
function failure(err: unknown, meta: Meta): Response {
  if (err instanceof Refusal) {
    // 5xx refusals are our problems (missing secret, bot check unreachable): log them.
    if (err.status >= 500 && err.detail) meta.logError(err.detail);
    if (err.code === "too_fast") return json({ error: "too_fast", retryAfter: 60 }, 429, { "retry-after": "60" });
    return json({ error: err.code }, err.status);
  }
  if (err instanceof NotJobAdError) return json({ error: "not_job_ad" }, 422);
  if (err instanceof AiError) {
    console.error(err.message);
    meta.logError(err.message);
    if (err.kind === "busy") {
      // The panel shows a countdown and retries once when the wait is short.
      return json(
        { error: "busy", ...(err.retryAfter && { retryAfter: err.retryAfter }) },
        429,
        err.retryAfter ? { "retry-after": String(err.retryAfter) } : {},
      );
    }
    if (err.kind === "too_large") return json({ error: "too_large" }, 413);
    return json({ error: "failed" }, 502);
  }
  const text = `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  console.error(text);
  meta.logError(text);
  return json({ error: "failed" }, 500);
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      ...headers,
    },
  });
}
