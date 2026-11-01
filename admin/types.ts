// The admin API's answers, shared by the Worker (index.ts) and the page (client/app.ts).

export type Kind = "chat" | "fit" | "error";
export type Filter = Kind | "all";

/** One row of the `entries` table (SPEC §9). */
export interface Entry {
  id: number;
  ts: string;
  kind: Kind;
  lang: string | null;
  text: string;
  score: number | null;
  label: string | null;
  role: string | null;
  company: string | null;
}

/** GET /api/summary */
export interface Summary {
  /** Since 00:00 UTC, when the site's daily limits start over. */
  today: { chat: number; fit: number; capChat: number; capFit: number };
  periods: { days: number; chat: number; fit: number }[];
  /** The newest error in the last 7 days, if any. */
  lastError: { ts: string; text: string } | null;
  retentionDays: number;
}

/** GET /api/entries?kind=&before= */
export interface EntriesPage {
  entries: Entry[];
  /** Whether there are older entries to load. */
  more: boolean;
}

/** Entries per page. */
export const PAGE_SIZE = 25;
