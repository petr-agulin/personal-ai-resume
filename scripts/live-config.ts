// The live D1 database ID never enters git: wrangler.jsonc and
// admin/wrangler.jsonc hold a placeholder, which local runs use as is.
// Before anything touches the live database, this looks the real ID up by
// name in your Cloudflare account and writes git-ignored copies of both
// configs with it: wrangler.live.jsonc and admin/wrangler.live.jsonc. They sit
// next to the originals, because the paths inside are relative.
// Used by `npm run deploy` and `npm run db:live`.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const CONFIGS = [
  ["wrangler.jsonc", "wrangler.live.jsonc"],
  ["admin/wrangler.jsonc", "admin/wrangler.live.jsonc"],
] as const;
export const LIVE = { site: CONFIGS[0][1], admin: CONFIGS[1][1] };

export class LiveConfigError extends Error {}

/** Returns the database's jurisdiction, e.g. "eu", or null when it has none. */
export function writeLiveConfigs(): string | null {
  const name = /"database_name":\s*"([^"]+)"/.exec(readFileSync(CONFIGS[0][0], "utf8"))?.[1];
  if (!name) throw new LiveConfigError("No database_name found in wrangler.jsonc.");

  let list: { name: string; uuid: string; jurisdiction?: string | null }[] | undefined;
  let reason = "";
  // Cloudflare's API sometimes fails once for no lasting reason, so try twice.
  for (let attempt = 1; attempt <= 2 && !list; attempt++) {
    try {
      list = JSON.parse(execSync("npx wrangler d1 list --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    } catch (err) {
      reason = String((err as { stderr?: string }).stderr ?? "").trim().split("\n").find((l) => l.trim()) ?? "";
    }
  }
  if (!list) {
    throw new LiveConfigError(
      `Couldn't list your Cloudflare databases${reason ? `: ${reason}` : "."}\n` +
        "Try again in a minute. If it keeps failing, log in again with: npx wrangler login",
    );
  }
  const db = list.find((d) => d.name === name);
  if (!db) {
    throw new LiveConfigError(
      `Your Cloudflare account has no database called "${name}" yet. Create it once (docs/SETUP.md):\n` +
        `  npx wrangler d1 create ${name} --jurisdiction=eu`,
    );
  }
  for (const [from, to] of CONFIGS) writeFileSync(to, readFileSync(from, "utf8").replaceAll(PLACEHOLDER, db.uuid));
  return db.jurisdiction ?? null;
}
