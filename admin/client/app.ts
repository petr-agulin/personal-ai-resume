// The admin page's script: loads the summary and the entries from /api/* and
// shows them. Everything visitors typed is shown as plain text (textContent).

import type { EntriesPage, Entry, Filter, Summary } from "../types.ts";

const TIME_ZONE = "Europe/Stockholm";
const DAY_MS = 24 * 60 * 60 * 1000;
const FIT_LABELS: Record<string, string> = {
  strong: "Strong fit",
  good: "Good fit",
  partial: "Partial fit",
  weak: "Weak fit",
};
const KIND_NAMES = { chat: "Question", fit: "Job fit", error: "Error" } as const;

const kpis = byId("kpis");
const lastError = byId("last-error");
const list = byId<HTMLOListElement>("entries");
const more = byId<HTMLButtonElement>("more");
const empty = byId("empty");
const status = byId("status");
const footnote = byId("footnote");

let filter: Filter = "all";
let oldestId: number | null = null;
/** Bumped on every fresh load, so a slow answer for an old filter is ignored. */
let generation = 0;

class SignedOut extends Error {}

// ------------------------------------------------------------------ loading

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // When the Access login has expired, Access answers with a redirect to its login page.
  const res = await fetch(path, { ...init, redirect: "manual", headers: { accept: "application/json" } });
  if (res.type === "opaqueredirect" || res.status === 403) throw new SignedOut();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function showProblem(err: unknown): void {
  status.textContent =
    err instanceof SignedOut
      ? "Your login has expired. Reload the page to sign in again."
      : "Couldn't load the log. Try reloading the page.";
  status.hidden = false;
}

async function loadSummary(): Promise<void> {
  try {
    renderSummary(await api<Summary>("/api/summary"));
  } catch (err) {
    showProblem(err);
  }
}

async function loadEntries(fresh: boolean): Promise<void> {
  if (fresh) {
    generation++;
    oldestId = null;
  }
  const mine = generation;
  const params = new URLSearchParams({ kind: filter });
  if (oldestId !== null) params.set("before", String(oldestId));
  more.disabled = true;
  try {
    const page = await api<EntriesPage>(`/api/entries?${params}`);
    if (mine !== generation) return;
    if (fresh) list.replaceChildren();
    list.append(...page.entries.map(renderEntry));
    oldestId = page.entries.at(-1)?.id ?? oldestId;
    more.hidden = !page.more;
    empty.hidden = list.childElementCount > 0;
  } catch (err) {
    if (mine === generation) showProblem(err);
  } finally {
    more.disabled = false;
  }
}

// ------------------------------------------------------------------ summary

function renderSummary(s: Summary): void {
  const resets = `Starts over at ${clock(nextUtcMidnight())}`;
  const capNote = (used: number, cap: number) => (used >= cap ? "Limit reached for today" : resets);
  kpis.replaceChildren(
    kpi("Questions today", `${s.today.chat} / ${s.today.capChat}`, capNote(s.today.chat, s.today.capChat), s.today.chat >= s.today.capChat),
    kpi("Job fits today", `${s.today.fit} / ${s.today.capFit}`, capNote(s.today.fit, s.today.capFit), s.today.fit >= s.today.capFit),
    ...s.periods.map((p) =>
      kpi(`Last ${p.days} days`, String(p.chat), `${p.chat === 1 ? "question" : "questions"} · ${plural(p.fit, "job fit")}`),
    ),
  );

  if (s.lastError) {
    lastError.replaceChildren(
      el("div", "card__label", "Last error"),
      el("div", "last-error__line", el("time", "time", when(s.lastError.ts)), el("span", "last-error__text", s.lastError.text)),
      el("p", "last-error__note", "Visitors saw a polite message instead of an answer. A model or key problem keeps failing until it's fixed."),
    );
    lastError.classList.add("last-error--bad");
  } else {
    lastError.replaceChildren(el("div", "last-error__ok", "No errors in the last 7 days."));
    lastError.classList.remove("last-error--bad");
  }
  footnote.textContent = `Entries older than ${s.retentionDays === 365 ? "12 months" : `${s.retentionDays} days`} are deleted automatically every night.`;
}

function kpi(label: string, value: string, note: string, warn = false): HTMLElement {
  return el(
    "div",
    "kpi",
    el("div", "card__label", label),
    el("div", warn ? "kpi__value kpi__value--warn" : "kpi__value", value),
    el("div", "kpi__note", note),
  );
}

// ------------------------------------------------------------------ entries

function renderEntry(e: Entry): HTMLLIElement {
  const li = el("li", `entry entry--${e.kind}`);
  li.dataset.id = String(e.id);

  const time = el("time", "time", when(e.ts));
  time.dateTime = e.ts;
  const meta = el(
    "div",
    "entry__meta",
    time,
    el("span", `tag tag--${e.kind}`, KIND_NAMES[e.kind]),
    el("span", "lang", e.lang ? e.lang.toUpperCase() : "–"),
  );

  const body = el("div", "entry__body");
  if (e.kind === "fit") {
    const band = e.label && e.label in FIT_LABELS ? e.label : "weak";
    body.append(
      el(
        "div",
        "fit",
        el("span", `fit__score fit__score--${band}`, e.score === null ? "–" : String(e.score)),
        el("span", "fit__label", e.label ? (FIT_LABELS[e.label] ?? e.label) : ""),
        el("span", "fit__role", e.role ?? "Role not found in the ad"),
        el("span", "fit__company", e.company ?? ""),
      ),
    );
    const details = el("details", "jobad", el("summary", "", "View job ad"), el("div", "jobad__text", e.text));
    body.append(details);
  } else {
    body.append(el("p", "entry__text", e.text));
  }

  li.append(meta, body, deleteControl(li, e.id));
  return li;
}

/** "Delete", which asks "Delete this entry?" before doing it. */
function deleteControl(li: HTMLLIElement, id: number): HTMLElement {
  const box = el("div", "entry__actions");
  const ask = button("Delete", "link-button");
  const confirm = el("span", "confirm", "Delete this entry?");
  const yes = button("Delete", "link-button link-button--danger");
  const no = button("Cancel", "link-button");
  confirm.append(yes, no);
  confirm.hidden = true;
  box.append(ask, confirm);

  ask.addEventListener("click", () => {
    ask.hidden = true;
    confirm.hidden = false;
    no.focus();
  });
  no.addEventListener("click", () => {
    confirm.hidden = true;
    ask.hidden = false;
    ask.focus();
  });
  yes.addEventListener("click", async () => {
    yes.disabled = no.disabled = true;
    try {
      await api(`/api/entries/${id}`, { method: "DELETE" });
      li.remove();
      empty.hidden = list.childElementCount > 0;
      void loadSummary();
    } catch (err) {
      yes.disabled = no.disabled = false;
      showProblem(err);
    }
  });
  return box;
}

// ------------------------------------------------------------------ helpers

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** An element with a class and children; strings become text, never HTML. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

function button(label: string, className: string): HTMLButtonElement {
  const b = el("button", className, label);
  b.type = "button";
  return b;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const hourMinute = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });

function clock(date: Date): string {
  return hourMinute.format(date);
}

/** "Today 14:12", "Yesterday 09:40", "20 Oct 14:12" or "20 Oct 2025 14:12", in Stockholm time. */
function when(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const day = dayKey.format(date);
  if (day === dayKey.format(now)) return `Today ${clock(date)}`;
  if (day === dayKey.format(new Date(now.getTime() - DAY_MS))) return `Yesterday ${clock(date)}`;
  const sameYear = day.slice(0, 4) === dayKey.format(now).slice(0, 4);
  return `${(sameYear ? dayMonth : dayMonthYear).format(date)} ${clock(date)}`;
}

/** When the site's daily limits start over: the next 00:00 UTC. */
function nextUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

// ------------------------------------------------------------------ start

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
  b.addEventListener("click", () => {
    filter = b.dataset.filter as Filter;
    for (const other of document.querySelectorAll("[data-filter]")) other.setAttribute("aria-pressed", String(other === b));
    void loadEntries(true);
  });
}
more.addEventListener("click", () => void loadEntries(false));

void loadSummary();
void loadEntries(true);
