// Runs SQL against the local visitor log (the D1 database in .wrangler/state
// that `npm run dev:ai` and `npm run admin:dev` use). Never the live one.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Wrangler's own script, run with this Node, so nothing depends on the shell's quoting rules.
const wranglerPackage = createRequire(import.meta.url).resolve("wrangler/package.json");
const wrangler = join(dirname(wranglerPackage), "bin", "wrangler.js");

/** For tests: D1_PERSIST_TO=<folder> uses a separate local database instead of .wrangler/state. */
const persist = process.env.D1_PERSIST_TO ? ["--persist-to", process.env.D1_PERSIST_TO] : [];

/** The rows the last statement returned. Exits with a readable message if the local log can't be read. */
export function localD1<T>(sql: string): T[] {
  let output: string;
  const args = [wrangler, "d1", "execute", "resume-log", "--local", ...persist, "--json", "--command", sql];
  try {
    output = execFileSync(process.execPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    console.error("Couldn't read the local log.", stderr.includes("no such table") ? "Run npm run db:local first." : "");
    console.error(stderr.trim());
    process.exit(1);
  }
  const results: { results?: T[] }[] = JSON.parse(output);
  return results.at(-1)?.results ?? [];
}
