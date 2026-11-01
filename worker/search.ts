// Finds the hidden topics (content/notes/*.md, plus one per case study) that fit a question.
// Each topic and the question are turned into "embeddings" (lists of numbers
// that capture meaning) by Cloudflare's multilingual bge-m3 model, so a
// Swedish question finds an English note. Topics are compared by cosine
// similarity; only close matches are sent to the AI.

import type { Env } from "./env.ts";
import { NOTES } from "./generated/context.ts";

const MODEL = "@cf/baai/bge-m3";
/** Below this similarity a topic counts as unrelated. Calibrated by testing. */
const MIN_SCORE = 0.45;
/** Texts per embedding request. */
const BATCH = 50;

export interface Note {
  title: string;
  text: string;
}

/** Topic embeddings, computed once per Worker instance and kept in memory. */
let topicVectors: Promise<number[][]> | null = null;

export async function findNotes(env: Env, query: string, max: number): Promise<Note[]> {
  if (NOTES.length === 0 || !query.trim()) return [];
  topicVectors ??= embed(
    env,
    NOTES.map((n) => `${n.title}\n${n.text}`),
  ).catch((err) => {
    topicVectors = null; // try again on the next question
    throw err;
  });
  const [vectors, [q]] = await Promise.all([topicVectors, embed(env, [query])]);
  const all = vectors.map((v, i) => ({ i, score: cosine(q, v) })).sort((a, b) => b.score - a.score);
  const ranked = all.filter((r) => r.score >= MIN_SCORE).slice(0, max);
  // Numbers only in the log (topic index and similarity), for tuning MIN_SCORE:
  // the three closest topics, used or not.
  const closest = all.slice(0, 3).map((r) => `#${r.i} ${r.score.toFixed(2)}${r.score >= MIN_SCORE ? "" : " (no)"}`);
  console.log(`Notes: ${ranked.length} of ${NOTES.length} topics used; closest: ${closest.join(", ")}`);
  return ranked.map((r) => NOTES[r.i]);
}

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const result = (await env.AI.run(MODEL, { text: texts.slice(i, i + BATCH), truncate_inputs: true })) as {
      data?: number[][];
    };
    if (!result.data || result.data.length !== Math.min(BATCH, texts.length - i)) {
      throw new Error("Workers AI: unexpected embedding response");
    }
    out.push(...result.data);
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Rough size in tokens. Measured October 2026: about 4.7 characters per token
 *  for English; Swedish runs a little lower, so this stays on the safe side. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4.2);
}

/** The topics (best match first) whose notes message fits in `budget` tokens.
 *  A topic too big for what's left is skipped, so a smaller one can still fit. */
export function notesWithin(notes: Note[], budget: number): Note[] {
  const kept: Note[] = [];
  for (const note of notes) {
    if (estimateTokens(notesMessage([...kept, note]) ?? "") <= budget) kept.push(note);
  }
  if (kept.length < notes.length) console.log(`Notes: kept ${kept.length} of ${notes.length} within the size budget`);
  return kept;
}

/** The selected topics as an extra system message, or null when none fit. */
export function notesMessage(notes: Note[]): string | null {
  if (notes.length === 0) return null;
  return [
    "MORE NOTES: these are part of the CONTEXT about me, picked because they fit the visitor's text. Same rules apply.",
    ...notes.map((n) => `### ${n.title}\n${n.text}`),
  ].join("\n\n");
}
