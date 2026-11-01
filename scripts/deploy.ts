// Publishes the site and the admin page to Cloudflare from this computer
// (SPEC §11): checks the content, builds both, then deploys the site Worker
// and the admin Worker. Run: npm run deploy
//
// Stops before publishing if the content is the fictional example person
// (content.example/) or still has placeholder text. To publish the example on
// purpose, e.g. as a demo: npm run deploy -- --example
// To rehearse without publishing anything: npm run deploy -- --dry-run

import { execSync } from "node:child_process";
import { ContentError, loadContent } from "../src/content/load.ts";
import { LIVE, LiveConfigError, writeLiveConfigs } from "./live-config.ts";

const allowExample = process.argv.includes("--example");
const dryRun = process.argv.includes("--dry-run") ? " --dry-run" : "";

let content;
try {
  content = loadContent();
} catch (err) {
  if (!(err instanceof ContentError)) throw err;
  console.error(`\n${err.message}\n`);
  process.exit(1);
}
console.log(`Content: ${content.label} (${content.site.name})`);

if (content.label.startsWith("content.example") && !allowExample) {
  stop(
    "This is the example person from content.example/, not your own content.\n" +
      "Create content/ first, or publish the example on purpose with: npm run deploy -- --example",
  );
}

const placeholders: string[] = [];
findPlaceholders(
  {
    "site.json": content.site,
    ...Object.fromEntries(Object.entries(content.locales).map(([lang, l]) => [`${lang}.json`, l])),
    "ai-notes.md": content.aiNotes,
    notes: content.notes,
  },
  "",
);
if (placeholders.length > 0 && !allowExample) {
  stop(`Placeholder text is still in the content:\n${placeholders.map((p) => `  - ${p}`).join("\n")}\nReplace it, then deploy again.`);
}

// The live database ID is looked up by name, never stored in git (scripts/live-config.ts).
let jurisdiction: string | null;
try {
  jurisdiction = writeLiveConfigs();
} catch (err) {
  if (!(err instanceof LiveConfigError)) throw err;
  stop(err.message);
}
// The privacy page names logRegion as where the log is stored; for the EU, Cloudflare can confirm it.
const region = content.site.logRegion;
if (region.toUpperCase() === "EU" && jurisdiction !== "eu") {
  stop(
    "Your privacy page says the visitor log is stored in the EU, but your database isn't restricted to the EU.\n" +
      'Either set "logRegion" in site.json to where it is, or create the database in the EU (docs/SETUP.md step D).',
  );
}
if (region.toUpperCase() !== "EU" && jurisdiction === "eu") {
  console.warn(`  Note: your database is in the EU, but site.json says "logRegion": "${region}". The privacy page will say ${region}.`);
}

run("npm run build", "the build");
run("node scripts/build-admin.ts", "the admin page build");
run(`npx wrangler deploy -c ${LIVE.site}${dryRun}`, "publishing the site");
run(`npx wrangler deploy -c ${LIVE.admin}${dryRun}`, "publishing the admin page", "The site is already published.");
console.log(dryRun ? "\nRehearsal finished. Nothing was published." : "\nPublished: the site and the admin page.");

function findPlaceholders(value: unknown, path: string) {
  if (typeof value === "string") {
    if (/placeholder|platshållare/i.test(value)) placeholders.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findPlaceholders(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) findPlaceholders(v, path ? `${path}.${k}` : k);
  }
}

function run(command: string, what: string, alreadyDone = "") {
  console.log(`\n> ${command}`);
  try {
    execSync(command, { stdio: "inherit" });
  } catch {
    stop(`Stopped: ${what} failed.${alreadyDone ? ` ${alreadyDone}` : ""} Nothing after this step was published.`);
  }
}

function stop(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}
