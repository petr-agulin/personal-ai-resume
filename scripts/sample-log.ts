// Adds made-up entries to the local visitor log, so the admin page has
// something to show: questions in both languages, job fits, two errors, and
// two entries older than 12 months that the nightly clean-up should delete.
// Local only; the live log is never touched. Run: npm run db:sample

import { localD1 } from "./local-d1.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Sample {
  /** How long ago, in days (fractions allowed). */
  ago: number;
  kind: "chat" | "fit" | "error";
  lang: "en" | "sv" | null;
  text: string;
  fit?: { score: number; label: string; role: string | null; company: string | null };
}

const samples: Sample[] = [
  { ago: 0.05, kind: "chat", lang: "en", text: "What's your biggest product win?" },
  { ago: 0.1, kind: "chat", lang: "en", text: "Tell me more about that. How did you measure it?" },
  {
    ago: 0.2,
    kind: "fit",
    lang: "en",
    text: "Senior Product Manager, Platform\n\nNorthwind Traders is looking for a Senior PM to own our integrations platform.\n\nYou will:\n- Own the roadmap for our public APIs and partner integrations\n- Work closely with engineering and developer relations\n- Talk to customers every week\n\nYou have 5+ years of B2B SaaS product management and experience with APIs.",
    fit: { score: 84, label: "strong", role: "Senior Product Manager, Platform", company: "Northwind Traders" },
  },
  { ago: 1.2, kind: "chat", lang: "sv", text: "Har du arbetstillstånd i Sverige?" },
  { ago: 1.4, kind: "chat", lang: "en", text: "How do you work with engineering?" },
  { ago: 3.1, kind: "error", lang: "en", text: "chat: groq.com 503: Service unavailable" },
  {
    ago: 3.5,
    kind: "fit",
    lang: "sv",
    text: "Produktägare, betalningar\n\nWoodgrove Bank söker en produktägare för våra betalningstjänster för företagskunder. Du prioriterar backloggen, arbetar med regelverk (PSD2) och har erfarenhet av banksystem.",
    fit: { score: 58, label: "partial", role: "Produktägare, betalningar", company: "Woodgrove Bank" },
  },
  { ago: 5, kind: "chat", lang: "en", text: "What role are you looking for next?" },
  { ago: 9, kind: "chat", lang: "sv", text: "Vad gjorde du på Corvid Analytics?" },
  {
    ago: 12,
    kind: "fit",
    lang: "en",
    text: "Product Manager, Growth (B2C mobile)\n\nTailspin Toys wants a PM to run A/B tests at scale in our consumer app, with deep experience in mobile growth loops and paid acquisition.",
    fit: { score: 41, label: "weak", role: "Product Manager, Growth", company: "Tailspin Toys" },
  },
  { ago: 16, kind: "chat", lang: "en", text: "Do you know SQL?" },
  { ago: 20, kind: "error", lang: "sv", text: "fit: groq.com 404: The model `example/old-model` does not exist or you do not have access to it." },
  { ago: 24, kind: "chat", lang: "en", text: "Tell me about your pricing work" },
  {
    ago: 33,
    kind: "fit",
    lang: "en",
    text: "Lead Product Manager, Data\n\nWe are hiring a product lead for our analytics product. Experience with dashboards, data teams and enterprise customers. Company details in the attached PDF.",
    fit: { score: 72, label: "good", role: "Lead Product Manager, Data", company: null },
  },
  { ago: 41, kind: "chat", lang: "sv", text: "Vilka språk talar du?" },
  { ago: 55, kind: "chat", lang: "en", text: "What do you do in your free time?" },
  {
    ago: 63,
    kind: "fit",
    lang: "en",
    text: "Senior PM, Developer Experience\n\nContoso builds tools for developers. You will own onboarding, docs and the CLI, and work with a team of eight engineers.",
    fit: { score: 79, label: "good", role: "Senior PM, Developer Experience", company: "Contoso" },
  },
  { ago: 78, kind: "chat", lang: "en", text: "Why did you leave your last job?" },
  // Older than 12 months: the nightly clean-up deletes these.
  { ago: 380, kind: "chat", lang: "en", text: "(Old sample) Are you open to relocation?" },
  { ago: 400, kind: "chat", lang: "sv", text: "(Gammalt exempel) Hur arbetar du med design?" },
];

const now = Date.now();
const quote = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
// Oldest first, so ids follow time like real entries.
const values = [...samples]
  .sort((a, b) => b.ago - a.ago)
  .map((s) => {
    const ts = new Date(now - s.ago * DAY_MS).toISOString();
    const f = s.fit;
    return `(${[ts, s.kind, s.lang, s.text, f?.score ?? null, f?.label ?? null, f?.role ?? null, f?.company ?? null].map(quote).join(", ")})`;
  });

localD1(`INSERT INTO entries (ts, kind, lang, text, score, label, role, company) VALUES ${values.join(",\n")}`);
const [{ n }] = localD1<{ n: number }>("SELECT COUNT(*) AS n FROM entries");
console.log(`Added ${samples.length} sample entries to the local log. It now has ${n} entries.`);
