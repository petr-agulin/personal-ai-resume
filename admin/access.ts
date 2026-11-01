// The login check (SPEC §9). Cloudflare Access asks the owner for a one-time
// code before any request reaches this Worker, then adds a signed token
// (a JWT) to the request. This Worker checks that token itself as well, so
// if Access is ever switched off or set up wrong, the admin refuses every
// request instead of showing the log. It fails closed: no settings, no token
// or a bad token all mean 403.
//
// Locally there is no Access. `npm run admin:dev` sets ACCESS_DEV_BYPASS, and
// the bypass only works when the address is localhost, which a deployed
// Worker never has, so it can't be turned on in production.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "./env.ts";

const DEV_BYPASS_VALUE = "local-only";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Access's public keys, fetched once per Worker instance; jose refetches them when Access rotates its key. */
const keySets = new Map<string, JWTVerifyGetKey>();

export async function hasAccess(request: Request, env: Env): Promise<boolean> {
  if (env.ACCESS_DEV_BYPASS === DEV_BYPASS_VALUE && LOCAL_HOSTS.has(new URL(request.url).hostname)) return true;

  // Accepts "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/".
  const team = (env.ACCESS_TEAM_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = (env.ACCESS_AUD ?? "").trim();
  if (!team || !aud) {
    console.error("Admin refused a request: ACCESS_TEAM_DOMAIN or ACCESS_AUD is not set.");
    return false;
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;

  const issuer = `https://${team}`;
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, keys);
  }
  try {
    await jwtVerify(token, keys, { issuer, audience: aud, algorithms: ["RS256"] });
    return true;
  } catch (err) {
    console.error("Admin refused a request: invalid Access token:", err instanceof Error ? err.name : "unknown");
    return false;
  }
}
