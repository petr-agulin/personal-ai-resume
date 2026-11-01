// Admin Worker (SPEC §9). Every request passes the login check first (access.ts),
// then:
//   GET    /api/summary                 →  Summary (today, 7/30/90 days, last error)
//   GET    /api/entries?kind=&before=   →  EntriesPage (newest first)
//   DELETE /api/entries/<id>            →  {deleted: true}
//   anything else                       →  the page in dist/ (client/, built by scripts/build-admin.ts)
// Once a day, the cron trigger deletes entries older than RETENTION_DAYS.

import { hasAccess } from "./access.ts";
import type { Env } from "./env.ts";
import { PAGE_SIZE, type EntriesPage, type Entry, type Filter, type Summary } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const FILTERS = new Set<Filter>(["all", "chat", "fit", "error"]);

// Strict for a private page: only this Worker's own files, never framed, never indexed or cached.
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env): Promise<Response> {
    if (!(await hasAccess(request, env))) return text("Forbidden", 403);

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      if (request.method !== "GET" && request.method !== "HEAD") return text("Method not allowed", 405);
      return withHeaders(await env.ASSETS.fetch(request));
    }
    try {
      return await api(request, url, env);
    } catch (err) {
      console.error("Admin API failed:", err instanceof Error ? err.message : String(err));
      return json({ error: "failed" }, 500);
    }
  },

  async scheduled(_controller, env): Promise<void> {
    const days = retentionDays(env);
    const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
    const result = await env.DB.prepare("DELETE FROM entries WHERE ts < ?1").bind(cutoff).run();
    console.log(`Retention: deleted ${result.meta.changes} entries older than ${days} days.`);
  },
} satisfies ExportedHandler<Env>;

async function api(request: Request, url: URL, env: Env): Promise<Response> {
  const { pathname } = url;
  if (pathname === "/api/summary" && request.method === "GET") return json(await summary(env));
  if (pathname === "/api/entries" && request.method === "GET") return json(await entries(env, url.searchParams));

  const match = /^\/api\/entries\/(\d+)$/.exec(pathname);
  if (match && request.method === "DELETE") {
    // Only this page may delete: browsers always send Origin with DELETE.
    if (request.headers.get("origin") !== url.origin) return json({ error: "forbidden" }, 403);
    const result = await env.DB.prepare("DELETE FROM entries WHERE id = ?1").bind(Number(match[1])).run();
    return json({ deleted: result.meta.changes > 0 });
  }
  return json({ error: "not_found" }, 404);
}

async function summary(env: Env): Promise<Summary> {
  const now = Date.now();
  // The site's daily limits count from 00:00 UTC (worker/log.ts), so "today" does too.
  const today = new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const since = (days: number) => new Date(now - days * DAY_MS).toISOString();

  const [counts, lastError] = await env.DB.batch([
    env.DB.prepare(
      `SELECT
         COALESCE(SUM(kind = 'chat' AND ts >= ?1), 0) AS chatToday,
         COALESCE(SUM(kind = 'fit'  AND ts >= ?1), 0) AS fitToday,
         COALESCE(SUM(kind = 'chat' AND ts >= ?2), 0) AS chat7,
         COALESCE(SUM(kind = 'fit'  AND ts >= ?2), 0) AS fit7,
         COALESCE(SUM(kind = 'chat' AND ts >= ?3), 0) AS chat30,
         COALESCE(SUM(kind = 'fit'  AND ts >= ?3), 0) AS fit30,
         COALESCE(SUM(kind = 'chat'), 0) AS chat90,
         COALESCE(SUM(kind = 'fit'), 0) AS fit90
       FROM entries WHERE ts >= ?4`,
    ).bind(today, since(7), since(30), since(90)),
    env.DB.prepare("SELECT ts, text FROM entries WHERE kind = 'error' AND ts >= ?1 ORDER BY id DESC LIMIT 1").bind(since(7)),
  ]);
  const c = counts.results[0] as Record<string, number>;
  const error = lastError.results[0] as { ts: string; text: string } | undefined;
  return {
    today: { chat: c.chatToday, fit: c.fitToday, capChat: Number(env.DAILY_CAP_CHAT), capFit: Number(env.DAILY_CAP_FIT) },
    periods: [
      { days: 7, chat: c.chat7, fit: c.fit7 },
      { days: 30, chat: c.chat30, fit: c.fit30 },
      { days: 90, chat: c.chat90, fit: c.fit90 },
    ],
    lastError: error ?? null,
    retentionDays: retentionDays(env),
  };
}

async function entries(env: Env, params: URLSearchParams): Promise<EntriesPage> {
  const kind = (params.get("kind") ?? "all") as Filter;
  const before = Number(params.get("before"));
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (FILTERS.has(kind) && kind !== "all") {
    binds.push(kind);
    where.push(`kind = ?${binds.length}`);
  }
  if (Number.isSafeInteger(before) && before > 0) {
    binds.push(before);
    where.push(`id < ?${binds.length}`);
  }
  // One extra row tells whether there is another page.
  binds.push(PAGE_SIZE + 1);
  const sql = `SELECT id, ts, kind, lang, text, score, label, role, company FROM entries
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?${binds.length}`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all<Entry>();
  return { entries: results.slice(0, PAGE_SIZE), more: results.length > PAGE_SIZE };
}

function retentionDays(env: Env): number {
  const days = Number(env.RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 365;
}

function withHeaders(response: Response): Response {
  const res = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value);
  return res;
}

function json(data: unknown, status = 200): Response {
  return withHeaders(
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } }),
  );
}

function text(body: string, status: number): Response {
  return withHeaders(new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } }));
}
