// The visitor log in D1 (SPEC §9): what visitors asked and pasted, and when.
// No IP address, user agent, cookie or visitor ID. Chat and fit rows are
// also what the daily totals count; error rows describe server problems.

import type { Env } from "./env.ts";

export type Kind = "chat" | "fit" | "error";

export interface Entry {
  kind: Kind;
  lang: string | null;
  text: string;
  score?: number | null;
  label?: string | null;
  role?: string | null;
  company?: string | null;
}

export async function logEntry(env: Env, e: Entry): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO entries (ts, kind, lang, text, score, label, role, company) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
  )
    .bind(new Date().toISOString(), e.kind, e.lang, e.text, e.score ?? null, e.label ?? null, e.role ?? null, e.company ?? null)
    .run();
}

/** How many entries of this kind there are today (UTC). */
export async function countToday(env: Env, kind: Kind): Promise<number> {
  const startOfDay = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE kind = ?1 AND ts >= ?2")
    .bind(kind, startOfDay)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
