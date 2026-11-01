// Generates the JSON Schemas in schema/ from src/content/schema.ts.
// Content files point to them with "$schema", which gives VS Code
// autocomplete, hover help and error highlighting with no extensions.
// Run: npm run schemas

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ICON_NAMES, localeSchema, siteSchema } from "../src/content/schema.ts";

const outDir = join(process.cwd(), "schema");
mkdirSync(outDir, { recursive: true });

const schemas: [string, string, z.ZodType][] = [
  ["site.schema.json", "site.json: settings that are the same in every language", siteSchema],
  ["locale.schema.json", "en.json / sv.json: all page text in one language", localeSchema],
];

for (const [file, title, schema] of schemas) {
  const json = z.toJSONSchema(schema, { target: "draft-07", io: "input", unrepresentable: "any" });
  const definitions: Record<string, unknown> = {};
  const body = shareIconList(json, definitions) as Record<string, unknown>;
  const out = JSON.stringify({ ...body, title, ...(Object.keys(definitions).length ? { definitions } : {}) }, null, 2) + "\n";

  const path = join(outDir, file);
  let current = "";
  try {
    current = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  } catch {}
  if (current !== out) {
    writeFileSync(path, out);
    console.log(`Updated schema/${file}`);
  }
}

/** Replaces every copy of the ~1,500 icon names with a reference to one shared list. */
function shareIconList(node: unknown, definitions: Record<string, unknown>): unknown {
  if (Array.isArray(node)) return node.map((n) => shareIconList(n, definitions));
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.enum) && obj.enum.length === ICON_NAMES.length) {
    definitions.icon = { type: "string", enum: ICON_NAMES };
    return { $ref: "#/definitions/icon", ...(obj.description ? { description: obj.description } : {}) };
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, shareIconList(v, definitions)]));
}
