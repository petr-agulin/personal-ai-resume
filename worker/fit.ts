// Job fit: ask for structured JSON, check it, clamp the score, and retry once
// if the answer doesn't have the expected shape (SPEC §6).

import { z } from "zod";
import { AiError, complete } from "./ai.ts";
import type { Env } from "./env.ts";
import { FIT_SCHEMA, fitSystemPrompt, fitUserMessage } from "./prompts.ts";
import { notesMessage, type Note } from "./search.ts";

const text = z.string().trim().min(1);
const titleDetail = z.object({ title: text, detail: text });
const FitOutput = z.object({
  score: z.number(),
  summary: text,
  strengths: z.array(titleDetail).min(1),
  gaps: z.array(titleDetail).min(1),
  highlights: z.array(z.object({ role: text, point: text })).min(1),
  role: z.string().trim().nullable(),
  company: z.string().trim().nullable(),
});

export type FitLabel = "strong" | "good" | "partial" | "weak";

export interface Fit {
  score: number;
  label: FitLabel;
  summary: string;
  strengths: { title: string; detail: string }[];
  gaps: { title: string; detail: string }[];
  highlights: { role: string; point: string }[];
  /** Extracted from the ad, for the owner's admin page only (not sent to the browser). */
  role: string | null;
  company: string | null;
}

/** The label always follows the score, so the two can't disagree. */
function labelFor(score: number): FitLabel {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 45) return "partial";
  return "weak";
}

/** The visitor's text isn't a job ad (a question, code, instructions...). Not an AI failure. */
export class NotJobAdError extends Error {}

export async function analyzeFit(env: Env, jobAd: string, notes: Note[]): Promise<Fit> {
  for (let attempt = 1; ; attempt++) {
    const raw = await complete(env, {
      system: fitSystemPrompt(),
      extraSystem: notesMessage(notes),
      messages: [{ role: "user", content: fitUserMessage(jobAd) }],
      maxTokens: 2500,
      // Low randomness, so the same ad gets about the same score each time.
      temperature: 0.2,
      schema: { name: "job_fit", schema: FIT_SCHEMA },
    });
    let parsed: z.infer<typeof FitOutput> | undefined;
    try {
      const json = JSON.parse(raw);
      if (json?.is_job_ad === false) throw new NotJobAdError("not a job ad");
      parsed = FitOutput.parse(json);
    } catch (err) {
      if (err instanceof NotJobAdError) throw err;
      if (attempt < 2) continue;
      throw new AiError("failed", "AI: job fit answer had the wrong shape (after one retry)");
    }
    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    return {
      score,
      label: labelFor(score),
      summary: parsed.summary,
      strengths: parsed.strengths.slice(0, 3),
      gaps: parsed.gaps.slice(0, 3),
      highlights: parsed.highlights.slice(0, 3),
      role: parsed.role || null,
      company: parsed.company || null,
    };
  }
}
