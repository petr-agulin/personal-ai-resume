// Validates the content and prints which folder (and whose name) is used,
// so a build or deploy of the wrong person is never an accident.
// Run: npm run content

import { ContentError, loadContent } from "../src/content/load.ts";

try {
  const content = loadContent();
  console.log(`Content: ${content.label} (${content.site.name})`);
  for (const warning of content.warnings) console.warn(`  Note: ${warning}`);
} catch (err) {
  if (!(err instanceof ContentError)) throw err;
  console.error(`\n${err.message}\n`);
  process.exit(1);
}
