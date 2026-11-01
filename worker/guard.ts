// Protection against abuse (SPEC §7): same-site requests only, a size limit
// on request bodies, Turnstile (Cloudflare's bot check) and the signed
// 30-minute pass that /api/session hands out after it.

import type { Env } from "./env.ts";

/** Request bodies above this are refused (SPEC §7). */
export const MAX_BODY_BYTES = 32 * 1024;
/** How long a pass lasts after the bot check. */
const PASS_MS = 30 * 60 * 1000;

/** A request the Worker refuses, with the status and code the browser gets.
 *  `detail` is for the log only (server problems), never sent to the browser. */
export class Refusal extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  constructor(status: number, code: string, detail?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Only pages on this site may call /api/*: the Origin header must match. */
export function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new Refusal(403, "forbidden");
}

/** Reads a JSON body of at most MAX_BODY_BYTES. */
export async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new Refusal(413, "too_long");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Refusal(413, "too_long");
  try {
    return JSON.parse(text);
  } catch {
    throw new Refusal(400, "invalid");
  }
}

// ------------------------------------------------------------------ Turnstile

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's published test secrets start like this; their answers carry no real hostname. */
const TEST_SECRET_PREFIX = "1x0000000000000000000000000000000";

/** Checks a Turnstile token with Cloudflare. Upstream details go to the log only. */
export async function verifyTurnstile(env: Env, request: Request, token: unknown): Promise<void> {
  if (typeof token !== "string" || !token || token.length > 2048) throw new Refusal(400, "invalid");
  if (!env.TURNSTILE_SECRET || env.TURNSTILE_SECRET.startsWith("replace-with")) {
    // Says which case it is without revealing anything: empty or the template's placeholder.
    const detail = `TURNSTILE_SECRET is not set (${env.TURNSTILE_SECRET ? "still the placeholder" : "empty"})`;
    console.error(detail);
    throw new Refusal(500, "failed", detail);
  }
  let result: { success?: boolean; hostname?: string; "error-codes"?: string[] };
  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    result = await res.json();
  } catch (err) {
    const detail = `Turnstile siteverify failed: ${(err as Error).name}`;
    console.error(detail);
    throw new Refusal(502, "failed", detail);
  }
  if (!result.success) {
    console.error(`Turnstile refused the token: ${(result["error-codes"] ?? []).join(", ") || "no reason given"}`);
    throw new Refusal(403, "not_verified");
  }
  // With a real key, the token must come from this site.
  const isTestKey = env.TURNSTILE_SECRET.startsWith(TEST_SECRET_PREFIX);
  if (!isTestKey && result.hostname !== new URL(request.url).hostname) {
    console.error(`Turnstile token from another hostname: ${result.hostname}`);
    throw new Refusal(403, "not_verified");
  }
}

// ----------------------------------------------------------------------- pass

/** A pass is "<expiry ms>.<HMAC-SHA256 of the expiry>", signed with PASS_SIGNING_KEY. */
export async function issuePass(env: Env): Promise<{ pass: string; expiresAt: number }> {
  const expiresAt = Date.now() + PASS_MS;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), payload(expiresAt));
  return { pass: `${expiresAt}.${base64url(signature)}`, expiresAt };
}

/** Throws 403 "no_pass" unless the request carries a valid, unexpired pass. */
export async function checkPass(env: Env, request: Request): Promise<void> {
  const key = await signingKey(env);
  const [exp, sig] = (request.headers.get("x-ai-pass") ?? "").split(".");
  const expiresAt = Number(exp);
  if (!sig || !Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) throw new Refusal(403, "no_pass");
  let signature: Uint8Array;
  try {
    signature = fromBase64url(sig);
  } catch {
    throw new Refusal(403, "no_pass");
  }
  // crypto.subtle.verify compares in constant time.
  if (!(await crypto.subtle.verify("HMAC", key, signature, payload(expiresAt)))) throw new Refusal(403, "no_pass");
}

async function signingKey(env: Env): Promise<CryptoKey> {
  const secret = env.PASS_SIGNING_KEY ?? "";
  if (secret.length < 32 || secret.startsWith("replace-with")) {
    const why = !secret ? "empty" : secret.startsWith("replace-with") ? "still the placeholder" : "shorter than 32 characters";
    const detail = `PASS_SIGNING_KEY is not set (${why})`;
    console.error(detail);
    throw new Refusal(500, "failed", detail);
  }
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const payload = (expiresAt: number) => new TextEncoder().encode(`ai-pass.v1.${expiresAt}`);

function base64url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ----------------------------------------------------------------- rate limit

/** Per-visitor speed limit, keyed by IP address. The IP is only counted, never stored. */
export async function checkRate(limiter: RateLimit, request: Request): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const { success } = await limiter.limit({ key: ip });
  if (!success) throw new Refusal(429, "too_fast");
}
