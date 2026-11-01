import type { Lang } from "../content/schema.ts";
import { en, type Strings } from "./en.ts";
import { sv } from "./sv.ts";

export type { Strings };

const strings: Record<Lang, Strings> = { en, sv };

export function t(lang: Lang): Strings {
  return strings[lang];
}

/** Label on the language switch. Swedish shows "SE" (owner's choice), the code stays "sv". */
export const SWITCH_LABEL: Record<Lang, string> = { en: "EN", sv: "SE" };

/** "2022-02" → "February 2022" / "februari 2022". */
export function formatMonth(yearMonth: string, lang: Lang): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Intl.DateTimeFormat(strings[lang].locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** Splits "a **b** c" into plain and bold parts. Everything else stays plain text. */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  return text
    .split("**")
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter((p) => p.text !== "");
}
