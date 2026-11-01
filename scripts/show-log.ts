// Prints the newest entries of the local visitor log (the D1 database that
// `npm run dev:ai` writes to), in plain text, times in Stockholm time.
// Run: npm run db:show          (the last 20)
//      npm run db:show -- 50    (the last 50)

import { localD1 } from "./local-d1.ts";

interface Row {
  id: number;
  ts: string;
  kind: string;
  lang: string | null;
  text: string;
  score: number | null;
  label: string | null;
  role: string | null;
  company: string | null;
}

const limit = Math.min(Math.max(Number(process.argv[2]) || 20, 1), 500);
const rows = localD1<Row>(
  `SELECT id, ts, kind, lang, text, score, label, role, company FROM entries ORDER BY id DESC LIMIT ${limit}`,
);
if (rows.length === 0) {
  console.log("The local log is empty.");
  process.exit(0);
}

const time = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
  timeStyle: "short",
});
const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

console.log(`Newest ${rows.length} entries in the local log (Stockholm time):\n`);
for (const r of rows) {
  const head = [`#${r.id}`, time.format(new Date(r.ts)), r.kind.padEnd(5), r.lang ?? "--"];
  if (r.kind === "fit") {
    head.push(`score ${r.score} (${r.label})`);
    const job = [r.role, r.company].filter(Boolean).join(" at ");
    if (job) head.push(job);
  }
  console.log(head.join("  "));
  console.log(`      ${oneLine(r.text, r.kind === "fit" ? 160 : 300)}\n`);
}
