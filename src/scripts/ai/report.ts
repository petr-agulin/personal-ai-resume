// The job-fit report, for "Email it" (a mailto: link) and "Download PDF"
// (the browser's print dialog, which can save as PDF). All text is set as
// plain text, never as HTML.

import type { FitResult, PanelConfig } from "./types.ts";

/** Mail clients cut off long mailto: links; keep the body around this size. */
const MAX_BODY = 1500;

export function mailtoHref(fit: FitResult, config: PanelConfig): string {
  const subject = config.strings.emailSubject;
  // Drop the details first, then cut the end, until the body is short enough.
  let body = reportText(fit, config, true);
  if (body.length > MAX_BODY) body = reportText(fit, config, false);
  if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY - 1) + "…";
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function reportText(fit: FitResult, config: PanelConfig, details: boolean): string {
  const s = config.strings;
  const list = (heading: string, lines: string[]) => (lines.length ? `\n${heading}\n${lines.join("\n")}\n` : "");
  const item = (mark: string, title: string, detail: string) => (details ? `${mark} ${title}: ${detail}` : `${mark} ${title}`);
  return (
    `${config.name} — ${config.title}\n` +
    `${s.fitScore}: ${fit.score}/100 (${s.labels[fit.label]})\n\n` +
    `${fit.summary}\n` +
    list(s.whereMatch, fit.strengths.map((x) => item("+", x.title, x.detail))) +
    list(s.gaps, fit.gaps.map((x) => item("-", x.title, x.detail))) +
    list(s.relevant, fit.highlights.map((x) => item("•", x.role, x.point))) +
    `\n${s.contact}: ${config.email}\n${s.generatedOn}`
  );
}

/** Fills the hidden print-only report and opens the print dialog. */
export function printReport(fit: FitResult, config: PanelConfig): void {
  const root = document.querySelector<HTMLElement>(".print-report");
  if (!root) return;
  const s = config.strings;
  const el = (tag: string, text?: string, className?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const section = (heading: string, rows: [string, string][]) => {
    if (!rows.length) return [];
    const ul = el("ul");
    for (const [title, detail] of rows) {
      const li = el("li");
      li.append(el("strong", title), ` — ${detail}`);
      ul.append(li);
    }
    return [el("h2", heading), ul];
  };

  const score = el("div", undefined, "print-report__score");
  const number = el("div", String(fit.score), "print-report__number");
  number.append(el("span", "/100"));
  const verdict = el("div");
  verdict.append(el("strong", s.labels[fit.label]), el("br"), fit.summary);
  score.append(number, verdict);

  root.replaceChildren(
    el("h1", `${config.name} — ${config.title}`),
    el("div", `${s.reportTitle} · ${config.email}`, "print-report__sub"),
    score,
    ...section(s.whereMatch, fit.strengths.map((x) => [x.title, x.detail])),
    ...section(s.gaps, fit.gaps.map((x) => [x.title, x.detail])),
    ...section(s.relevant, fit.highlights.map((x) => [x.role, x.point])),
    el("div", `${s.generatedOn} · ${new Date().toLocaleDateString(config.lang === "sv" ? "sv-SE" : "en-US")}`, "print-report__footer"),
  );

  // The PDF's suggested file name comes from the page title.
  const title = document.title;
  document.title = `${s.reportTitle} — ${config.name}`;
  document.documentElement.classList.add("printing-report");
  const done = () => {
    document.documentElement.classList.remove("printing-report");
    document.title = title;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
