// @ts-check
import { defineConfig } from "astro/config";
import { contentIntegration } from "./src/content/integration.ts";
import { securityHeaders } from "./src/headers-integration.ts";

// Static output: Astro pre-renders every page to plain HTML in dist/.
// The Cloudflare Worker serves those files and handles /api/* itself.
export default defineConfig({
  output: "static",
  integrations: [contentIntegration(), securityHeaders()],
});
