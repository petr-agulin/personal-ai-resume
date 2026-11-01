// What the admin Worker gets from Cloudflare (admin/wrangler.jsonc).

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  DAILY_CAP_CHAT: string;
  DAILY_CAP_FIT: string;
  RETENTION_DAYS: string;
  /** From the Access setup (SETUP step H), e.g. "<team>.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's "Application Audience (AUD) tag". */
  ACCESS_AUD?: string;
  /** Set only by `npm run admin:dev`; see access.ts. */
  ACCESS_DEV_BYPASS?: string;
}
