// Calls an OpenAI-compatible chat completions API with fetch (SPEC §6): the
// address is AI_API_URL in wrangler.jsonc, Groq by default. Most providers
// accept this request format. Upstream error text is for logs only and never
// reaches the browser.

import type { Env } from "./env.ts";

const TIMEOUT_MS = 30_000;

/** "busy": the provider's rate limit (the visitor can try again shortly). "too_large": the request
 *  is bigger than the plan allows per minute, so waiting won't help. "failed": anything else. */
export class AiError extends Error {
  readonly kind: "busy" | "too_large" | "failed";
  /** For "busy": the seconds the provider asks us to wait, when it says. */
  readonly retryAfter?: number;
  constructor(kind: "busy" | "too_large" | "failed", message: string, retryAfter?: number) {
    super(message);
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

export interface CompletionRequest {
  /** The fixed instructions: identical on every call, so the provider can cache them. */
  system: string;
  /** A second system message for per-question material (the notes found for it). */
  extraSystem?: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Reasoning counts against this too, so leave room for it. */
  maxTokens: number;
  /** Lower = more consistent answers. Providers' default is usually 1. */
  temperature?: number;
  /** Structured output (strict JSON schema). */
  schema?: { name: string; schema: object };
}

export async function complete(env: Env, req: CompletionRequest): Promise<string> {
  if (!env.AI_API_KEY) throw new AiError("failed", "AI_API_KEY is not set");
  const host = new URL(env.AI_API_URL).hostname;
  // Shown in error rows on the admin page, e.g. "groq.com 429: rate limited".
  const provider = host.replace(/^api\./, "");

  let res: Response;
  try {
    res = await fetch(env.AI_API_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.AI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          { role: "system", content: req.system },
          ...(req.extraSystem ? [{ role: "system" as const, content: req.extraSystem }] : []),
          ...req.messages,
        ],
        // gpt-oss on Groq reasons before answering: keep it short and out of the
        // response. Other providers may not know these two settings.
        ...(host === "api.groq.com" && { reasoning_effort: "low", include_reasoning: false }),
        max_completion_tokens: req.maxTokens,
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.schema && {
          response_format: { type: "json_schema", json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema } },
        }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new AiError("failed", `${provider} request failed: ${(err as Error).name}`);
  }

  if (res.status === 429) {
    const seconds = Math.ceil(Number.parseFloat(res.headers.get("retry-after") ?? ""));
    const retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
    throw new AiError("busy", `${provider} 429: rate limited${retryAfter ? `, retry after ${retryAfter} s` : ""}`, retryAfter);
  }
  if (res.status === 413) throw new AiError("too_large", `${provider} 413: ${await errorMessage(res)}`);
  if (!res.ok) throw new AiError("failed", `${provider} ${res.status}: ${await errorMessage(res)}`);

  const data = (await res.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  // Token counts only (never any text), for tuning the daily caps against the AI plan.
  // The system prompt is identical on every call, so providers like Groq cache it, and
  // on Groq cached tokens don't count toward the plan's limits.
  const u = data.usage;
  if (u) {
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    console.log(`AI tokens: ${u.prompt_tokens} in (${cached} cached), ${u.completion_tokens} out`);
  }
  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (choice?.finish_reason === "length") throw new AiError("failed", `${provider}: answer cut off (max_completion_tokens reached)`);
  if (!text) throw new AiError("failed", `${provider}: empty answer`);
  return text;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return (body.error?.message ?? res.statusText).slice(0, 200);
  } catch {
    return res.statusText;
  }
}
