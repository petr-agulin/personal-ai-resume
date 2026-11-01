// Loads and validates the site content. Uses content/ if it exists,
// otherwise content.example/. The CONTENT_DIR env var overrides both.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { z } from "zod";
import { LANGS, localeSchema, siteSchema, type Lang, type Locale, type Site } from "./schema.ts";

export interface Content {
  /** Absolute path of the content folder. */
  dir: string;
  /** The folder as printed to the owner, e.g. "content/". */
  label: string;
  site: Site;
  locales: Partial<Record<Lang, Locale>>;
  /** ai-notes.md, or null when the file doesn't exist. Always sent to the AI. */
  aiNotes: string | null;
  /** Topics from notes/*.md (one per "## Heading"). The AI gets only the ones relevant to a question. */
  notes: NoteTopic[];
  warnings: string[];
}

export interface NoteTopic {
  /** e.g. "skills.md" */
  file: string;
  title: string;
  text: string;
}

/** Topics longer than this get a warning: each one the search picks adds to that question's size. */
const TOPIC_WORDS_WARN = 600;

/** Thrown when the content has problems. The message is meant for the owner. */
export class ContentError extends Error {
  override name = "ContentError";
}

export function resolveContentDir(root = process.cwd()): string {
  const override = process.env.CONTENT_DIR;
  if (override) return resolve(root, override);
  const own = join(root, "content");
  return existsSync(own) ? own : join(root, "content.example");
}

/** Reads the content fresh on every call, so `npm run dev` picks up edits. */
export function loadContent(): Content {
  return readContent(resolveContentDir());
}

function readContent(dir: string): Content {
  const label = relative(process.cwd(), dir).replaceAll("\\", "/") + "/";
  const problems: Problem[] = [];
  const warnings: string[] = [];

  if (!existsSync(dir)) {
    throw new ContentError(`Content folder not found: ${label}`);
  }

  const site = parseFile(dir, "site.json", siteSchema, problems);
  const locales: Partial<Record<Lang, Locale>> = {};
  // If site.json is broken, still check whichever language files exist.
  const langs = site?.languages ?? LANGS.filter((l) => existsSync(join(dir, `${l}.json`)));
  for (const lang of langs) {
    const locale = parseFile(dir, `${lang}.json`, localeSchema, problems, (file) =>
      `File not found. site.json lists "${lang}" in "languages", so ${label}${file} must exist.`,
    );
    if (locale) locales[lang] = locale;
  }

  const notesPath = join(dir, "ai-notes.md");
  const aiNotes = existsSync(notesPath) ? readFileSync(notesPath, "utf8") : null;
  const notes = readNotes(dir, problems, warnings);

  for (const [lang, locale] of Object.entries(locales)) {
    checkFiles(dir, `${lang}.json`, locale, problems);
  }
  if (aiNotes) findPhoneNumbers("ai-notes.md", aiNotes, [], problems);

  if (site && !site.turnstileSiteKey) {
    warnings.push(
      "No turnstileSiteKey in site.json yet, so the bot check uses Cloudflare's test key, which lets everyone through. Set the real key before going live (docs/SETUP.md step E).",
    );
  }
  if (!existsSync(join(dir, "files", "og-image.png"))) {
    warnings.push(`No ${label}files/og-image.png yet, so link previews will have no image.`);
  }

  if (problems.length > 0) throw new ContentError(formatProblems(label, problems));
  return { dir, label, site: site!, locales, aiNotes, notes, warnings };
}

/** Reads notes/*.md: each "## Heading" starts one topic. <!-- comments --> are ignored. */
function readNotes(dir: string, problems: Problem[], warnings: string[]): NoteTopic[] {
  const notesDir = join(dir, "notes");
  if (!existsSync(notesDir)) return [];
  const topics: NoteTopic[] = [];
  for (const file of readdirSync(notesDir).filter((f) => f.endsWith(".md")).sort()) {
    const raw = readFileSync(join(notesDir, file), "utf8").replace(/^﻿/, "").replace(/<!--[\s\S]*?-->/g, "");
    const [before, ...sections] = raw.split(/^## +/m);
    if (before.trim().replace(/^# .*$/m, "").trim()) {
      warnings.push(`notes/${file}: text before the first "## Heading" is ignored. Put it under a heading.`);
    }
    for (const section of sections) {
      const newline = section.indexOf("\n");
      const title = (newline === -1 ? section : section.slice(0, newline)).trim();
      const text = newline === -1 ? "" : section.slice(newline + 1).trim();
      if (!text) {
        warnings.push(`notes/${file}: the topic "${title}" has no text, so it's skipped.`);
        continue;
      }
      const words = text.split(/\s+/).length;
      if (words > TOPIC_WORDS_WARN) {
        warnings.push(`notes/${file}: the topic "${title}" has ${words} words. Consider splitting it (aim for under ${TOPIC_WORDS_WARN}).`);
      }
      findPhoneNumbers(`notes/${file}`, text, [title], problems);
      topics.push({ file, title, text });
    }
  }
  return topics;
}

// ------------------------------------------------------------------ parsing

interface Problem {
  file: string;
  path: string;
  message: string;
}

function parseFile<T extends z.ZodType>(
  dir: string,
  file: string,
  schema: T,
  problems: Problem[],
  missing: (file: string) => string = () => "File not found.",
): z.output<T> | undefined {
  const path = join(dir, file);
  if (!existsSync(path)) {
    problems.push({ file, path: "", message: missing(file) });
    return undefined;
  }

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    problems.push({ file, path: "", message: `This isn't valid JSON: ${(err as Error).message}` });
    return undefined;
  }

  // Runs on the raw data, so it works even when other fields are wrong.
  findPhoneNumbers(file, data, [], problems);

  const result = schema.safeParse(data, { reportInput: true });
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    problems.push({ file, path: formatPath(issue.path), message: describeIssue(issue) });
  }
  return undefined;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((k) => `"${k}"`).join(", ");
    return `Unknown field ${keys}. Check the spelling; VS Code suggests the valid field names.`;
  }
  if (issue.code === "invalid_type" && issue.input === undefined) {
    return "Missing. This field is required.";
  }
  return issue.message;
}

function formatPath(path: PropertyKey[]): string {
  return path
    .map((key, i) => (typeof key === "number" ? `[${key}]` : i === 0 ? String(key) : `.${String(key)}`))
    .join("");
}

function formatProblems(label: string, problems: Problem[]): string {
  const count = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
  const lines = problems.map((p) => {
    const where = p.path ? `${p.file} › ${p.path}` : p.file;
    return `  ${where}\n    ${p.message}`;
  });
  return [
    `Content check failed: ${count} in ${label}`,
    "",
    ...lines,
    "",
    "Fix it in VS Code (the field is underlined in red), save, and run the command again.",
  ].join("\n");
}

// ------------------------------------------------------------ extra checks

/** Every `file` field must point to an existing file in files/. */
function checkFiles(dir: string, file: string, locale: Locale, problems: Problem[]) {
  const refs: [string, string | undefined][] = [
    ...locale.education.certifications.map((c, i): [string, string | undefined] => [
      `education.certifications[${i}].file`,
      c.file,
    ]),
    ...locale.languages.flatMap((l, i) =>
      l.tests.map((t, j): [string, string | undefined] => [`languages[${i}].tests[${j}].file`, t.file]),
    ),
  ];
  for (const [path, ref] of refs) {
    if (ref && !existsSync(join(dir, "files", ref))) {
      problems.push({ file, path, message: `File not found: files/${ref}` });
    }
  }
}

// The site never shows a phone number, and the AI must not know one either.
// Nine or more digits, optionally separated by spaces, dots, dashes or brackets.
const PHONE = /\+?\(?\d(?:[\s.()-]*\d){8,}/;

function findPhoneNumbers(file: string, value: unknown, path: PropertyKey[], problems: Problem[]) {
  if (typeof value === "string") {
    if (PHONE.test(value)) {
      problems.push({
        file,
        path: formatPath(path),
        message: "This looks like a phone number. The site never shows one, so remove it (or reword the number).",
      });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findPhoneNumbers(file, v, [...path, i], problems));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k !== "$schema") findPhoneNumbers(file, v, [...path, k], problems);
    }
  }
}
