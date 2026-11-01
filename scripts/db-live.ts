// Applies the database migrations to the LIVE database (the visitor log on
// Cloudflare). Changes live data: ask the owner first. Local runs use
// `npm run db:local` instead. Run: npm run db:live

import { execSync } from "node:child_process";
import { LIVE, LiveConfigError, writeLiveConfigs } from "./live-config.ts";

try {
  writeLiveConfigs();
} catch (err) {
  if (!(err instanceof LiveConfigError)) throw err;
  console.error(`\n${err.message}\n`);
  process.exit(1);
}
try {
  execSync(`npx wrangler d1 migrations apply resume-log --remote -c ${LIVE.site}`, { stdio: "inherit" });
} catch {
  process.exit(1);
}
