// The AI panel: open/close, the two modes, chat, job fit, and the report
// buttons. State is kept in sessionStorage (this tab only, the visitor's own
// text), so it survives closing the panel and switching language. Every piece
// of visitor or AI text is set with textContent, never as HTML.

import { analyzeFit, ApiError, askChat, warmUp } from "./api.ts";
import { mailtoHref, printReport } from "./report.ts";
import type { ChatMessage, FitResult, Mode, PanelConfig } from "./types.ts";

const STORAGE_KEY = "ai-panel";
/** The API only ever sees the last 10 messages. */
const HISTORY_SENT = 10;
/** Older messages are dropped from storage after this many. */
const HISTORY_KEPT = 50;
/** When the AI is busy and asks for a wait this short (seconds), the panel counts
 *  down and tries once more by itself. Longer waits: a message instead. One retry
 *  only: with a per-minute limit, quick repeats hit the same wall. */
const AUTO_RETRY_MAX = 30;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface State {
  open: boolean;
  mode: Mode;
  messages: ChatMessage[];
  draft: string;
  jobAd: string;
  fit: FitResult | null;
}

function loadState(): State {
  const fallback: State = { open: false, mode: "ask", messages: [], draft: "", jobAd: "", fit: null };
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return fallback;
    return {
      open: saved.open === true,
      mode: saved.mode === "fit" ? "fit" : "ask",
      messages: Array.isArray(saved.messages)
        ? saved.messages
            .filter((m: ChatMessage) => (m?.role === "user" || m?.role === "assistant") && typeof m.text === "string")
            .map((m: ChatMessage) => ({
              role: m.role,
              text: m.text,
              ...(m.error === true && { error: true }),
              ...(m.limit === true && { limit: true }),
            }))
        : [],
      draft: typeof saved.draft === "string" ? saved.draft : "",
      jobAd: typeof saved.jobAd === "string" ? saved.jobAd : "",
      fit: saved.fit && typeof saved.fit.score === "number" ? saved.fit : null,
    };
  } catch {
    return fallback;
  }
}

export function initPanel(): void {
  const panel = document.getElementById("ai-panel");
  if (!panel) return;
  const config = JSON.parse(panel.dataset.config ?? "{}") as PanelConfig;
  const root = document.documentElement;
  /** A friendly message in the page language; never the server's own error text. */
  const errorText = (err: unknown, fallback: string, tooLarge: string) => {
    if (!(err instanceof ApiError)) return fallback;
    switch (err.code) {
      case "too_large":
        return tooLarge;
      case "not_job_ad":
        return config.strings.notJobAd;
      case "resting":
        return config.strings.resting;
      case "too_fast":
        return config.strings.tooFast;
      case "not_verified":
        return config.strings.verifyFailed;
      case "busy":
        return err.retryAfter && err.retryAfter > AUTO_RETRY_MAX
          ? config.strings.busyLater.replace("{m}", String(Math.ceil(err.retryAfter / 60)))
          : config.strings.busy;
      default:
        return fallback;
    }
  };
  /** Errors caused by usage limits get a "Why?" link to the note about wait times. */
  const isLimitError = (err: unknown) =>
    err instanceof ApiError && (err.code === "busy" || err.code === "too_fast" || err.code === "resting");

  /** Runs an AI call. If the AI is busy for a short while, shows a countdown
   *  through `show` (null when done) and tries once more. */
  async function withRetry<T>(call: () => Promise<T>, show: (text: string | null) => void): Promise<T> {
    try {
      return await call();
    } catch (err) {
      const seconds = err instanceof ApiError && err.code === "busy" ? err.retryAfter : undefined;
      if (!seconds || seconds > AUTO_RETRY_MAX) throw err;
      for (let left = seconds; left > 0; left--) {
        show(config.strings.waitRetry.replace("{s}", String(left)));
        await wait(1000);
      }
      show(null);
      return await call();
    }
  }
  const state = loadState();
  let chatBusy = false;
  let fitBusy = false;
  let opener: HTMLElement | null = null;

  const q = <T extends Element = HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const messagesBox = q(".ai-messages");
  const empty = q(".ai-empty");
  const thread = q(".ai-thread");
  const typing = q(".ai-typing");
  const chatForm = q<HTMLFormElement>(".ai-compose");
  const input = q<HTMLInputElement>(".ai-compose input");
  const chatCounter = q(".ai-compose .ai-counter");
  const fitForm = q<HTMLFormElement>(".ai-fit-form");
  const jobAd = q<HTMLTextAreaElement>(".ai-fit-form textarea");
  const fitError = q(".ai-fit-error");
  const fitCounter = q(".ai-fit-form .ai-counter");
  const fitLoading = q(".ai-fit-loading");
  const fitResult = q(".ai-fit-result");
  const fitScroll = q(".ai-fit");
  const typingWait = q(".ai-typing__wait");
  const typingNote = q(".ai-typing__note");
  const fitLoadingText = q(".ai-fit-loading__text");
  const fitLoadingWhy = q(".ai-fit-loading [data-ai-why]");
  const limitsNote = q("#ai-limits");
  const infoButton = q("[data-ai-info]");

  const showChatWait = (text: string | null) => {
    typingNote.textContent = text ? `${text} ` : "";
    typingWait.hidden = text === null;
    scrollThreadToEnd();
  };
  const showFitWait = (text: string | null) => {
    fitLoadingText.textContent = text ?? fitLoadingText.dataset.default ?? "";
    fitLoadingWhy.hidden = text === null;
  };

  /** A "Why?" link that opens the note about wait times. */
  function whyButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-why";
    button.dataset.aiWhy = "";
    button.textContent = config.strings.why;
    return button;
  }

  /** Opens or closes the note about wait times. Focus moves into it, and back to the (i) button when closed. */
  function setLimitsOpen(open: boolean) {
    limitsNote.hidden = !open;
    infoButton.setAttribute("aria-expanded", String(open));
    if (open) limitsNote.focus({ preventScroll: true });
    else infoButton.focus({ preventScroll: true });
  }

  function save() {
    try {
      state.messages = state.messages.slice(-HISTORY_KEPT);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable (private mode, blocked); the panel still works.
    }
  }

  // ------------------------------------------------------------ open, mode

  function setOpen(open: boolean) {
    state.open = open;
    root.classList.toggle("ai-open", open);
    save();
    if (open) {
      warmUp(config); // the bot check runs in the background while the visitor types
      // On phones, focusing a field would pop up the keyboard straight away.
      const field = state.mode === "ask" ? input : jobAd;
      if (window.matchMedia("(pointer: fine)").matches && !(state.mode === "fit" && state.fit)) field.focus();
      else panel!.focus({ preventScroll: true });
      scrollThreadToEnd();
    } else {
      (opener ?? document.querySelector<HTMLElement>(".ai-launcher"))?.focus({ preventScroll: true });
    }
  }

  function setMode(mode: Mode) {
    state.mode = mode;
    root.dataset.aiView = mode;
    for (const b of panel!.querySelectorAll<HTMLButtonElement>("[data-ai-mode]")) {
      b.setAttribute("aria-pressed", String(b.dataset.aiMode === mode));
    }
    save();
  }

  // ------------------------------------------------------------------ chat

  function bubble(m: ChatMessage) {
    const div = document.createElement("div");
    div.className = m.role === "user" ? "ai-bubble ai-bubble--user" : "ai-bubble";
    div.textContent = m.text;
    if (m.limit) div.append(" ", whyButton());
    return div;
  }

  function renderMessages() {
    thread.replaceChildren(...state.messages.map(bubble));
    empty.hidden = state.messages.length > 0;
    typing.hidden = !chatBusy;
    scrollThreadToEnd();
  }

  function scrollThreadToEnd() {
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  async function send(text: string) {
    text = text.trim().slice(0, config.limits.chat);
    if (!text || chatBusy) return;
    const question: ChatMessage = { role: "user", text };
    state.messages.push(question);
    state.draft = "";
    input.value = "";
    updateCounter(input, chatCounter, config.limits.chat);
    chatBusy = true;
    save();
    renderMessages();
    try {
      const history = state.messages.filter((m) => !m.error).slice(-HISTORY_SENT);
      const reply = await withRetry(() => askChat(config, history), showChatWait);
      state.messages.push({ role: "assistant", text: reply });
    } catch (err) {
      // The unanswered question stays out of the history sent next time, and
      // goes back in the input box (unless the visitor has started typing
      // something else), so asking again is one press of Enter.
      question.error = true;
      state.messages.push({
        role: "assistant",
        text: errorText(err, config.strings.errorChat, config.strings.tooLargeChat),
        error: true,
        ...(isLimitError(err) && { limit: true }),
      });
      if (!input.value.trim()) {
        input.value = state.draft = text;
        updateCounter(input, chatCounter, config.limits.chat);
      }
    } finally {
      showChatWait(null);
      chatBusy = false;
      save();
      renderMessages();
    }
  }

  // --------------------------------------------------------------- job fit

  function renderFit() {
    const fit = state.fit;
    fitForm.hidden = !!fit || fitBusy;
    fitLoading.hidden = !fitBusy;
    fitResult.hidden = !fit;
    if (!fit) return;

    q(".ai-score").style.setProperty("--score", String(fit.score));
    q(".ai-score__number").textContent = String(fit.score);
    q(".ai-verdict__label").textContent = config.strings.labels[fit.label];
    q(".ai-verdict__summary").textContent = fit.summary;
    fillList(".ai-list--match", fit.strengths.map((x) => [x.title, x.detail]));
    fillList(".ai-list--gaps", fit.gaps.map((x) => [x.title, x.detail]));
    q(".ai-tiles").replaceChildren(
      ...fit.highlights.map((h) => {
        const tile = document.createElement("li");
        tile.className = "ai-tile";
        const role = document.createElement("div");
        role.className = "ai-tile__role";
        role.textContent = h.role;
        const point = document.createElement("div");
        point.className = "ai-tile__point";
        point.textContent = h.point;
        tile.append(role, point);
        return tile;
      }),
    );
    q<HTMLAnchorElement>("[data-ai-email]").href = mailtoHref(fit, config);
  }

  function fillList(selector: string, rows: [string, string][]) {
    const list = q(selector);
    list.closest<HTMLElement>(".ai-group")!.hidden = rows.length === 0;
    list.replaceChildren(
      ...rows.map(([title, detail]) => {
        // The marker (+ or –) is the first grid column; title and detail share the second.
        const li = document.createElement("li");
        const text = document.createElement("div");
        const strong = document.createElement("span");
        strong.className = "ai-list__title";
        strong.textContent = title;
        const rest = document.createElement("span");
        rest.className = "ai-list__detail";
        rest.textContent = ` — ${detail}`;
        text.append(strong, rest);
        li.append(text);
        return li;
      }),
    );
  }

  async function analyze() {
    const text = jobAd.value.trim();
    const { jobAdMin, jobAdMax } = config.limits;
    if (text.length < jobAdMin || text.length > jobAdMax) {
      // Too long: say so rather than cut it, which could drop the requirements at the end.
      const count = (n: number) => n.toLocaleString(config.lang);
      fitError.textContent =
        text.length < jobAdMin
          ? config.strings.tooShort
          : config.strings.jobAdTooLong.replace("{n}", count(text.length)).replace("{max}", count(jobAdMax));
      fitError.hidden = false;
      jobAd.focus();
      return;
    }
    if (fitBusy) return;
    fitBusy = true;
    renderFit();
    try {
      state.fit = await withRetry(() => analyzeFit(config, text), showFitWait);
    } catch (err) {
      fitError.textContent = errorText(err, config.strings.errorFit, config.strings.tooLargeFit);
      if (isLimitError(err)) fitError.append(" ", whyButton());
      fitError.hidden = false;
    } finally {
      showFitWait(null);
      fitBusy = false;
      save();
      renderFit();
      fitScroll.scrollTop = 0;
      panel!.focus({ preventScroll: true });
    }
  }

  function resetFit() {
    state.fit = null;
    state.jobAd = "";
    jobAd.value = "";
    updateCounter(jobAd, fitCounter, config.limits.jobAdMax);
    save();
    renderFit();
    jobAd.focus();
  }

  // ------------------------------------------------------------- counters

  function updateCounter(field: HTMLInputElement | HTMLTextAreaElement, counter: HTMLElement, max: number) {
    const n = field.value.length;
    counter.hidden = n < max * 0.8;
    counter.textContent = `${n} / ${max}`;
    counter.classList.toggle("is-full", n >= max);
  }

  // --------------------------------------------------------------- events

  document.addEventListener("click", (e) => {
    const target = e.target as Element;
    const openButton = target.closest<HTMLElement>("[data-ai-open]");
    if (openButton) {
      opener = openButton;
      const mode = openButton.dataset.aiOpen;
      if (mode === "ask" || mode === "fit") setMode(mode);
      setOpen(true);
      return;
    }
    if (!panel.contains(target)) return;
    if (target.closest("[data-ai-close]")) setOpen(false);
    if (target.closest("[data-ai-info]")) setLimitsOpen(Boolean(limitsNote.hidden));
    if (target.closest("[data-ai-why]")) setLimitsOpen(true);
    if (target.closest("[data-ai-limits-close]")) setLimitsOpen(false);
    const modeButton = target.closest<HTMLElement>("button[data-ai-mode]");
    if (modeButton) setMode(modeButton.dataset.aiMode === "fit" ? "fit" : "ask");
    const starter = target.closest<HTMLElement>("[data-starter]");
    if (starter) send(starter.textContent ?? "");
    if (target.closest("[data-ai-pdf]") && state.fit) printReport(state.fit, config);
    if (target.closest("[data-ai-reset]")) resetFit();
    if (target.closest("[data-ai-contact]")) {
      const contact = document.getElementById("contact");
      if (contact) window.scrollTo({ top: contact.getBoundingClientRect().top + window.scrollY - 60 });
    }
  });

  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Esc closes the note about wait times first, then the panel.
    if (!limitsNote.hidden) setLimitsOpen(false);
    else setOpen(false);
  });

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener("input", () => {
    state.draft = input.value;
    updateCounter(input, chatCounter, config.limits.chat);
    save();
  });

  fitForm.addEventListener("submit", (e) => {
    e.preventDefault();
    analyze();
  });
  jobAd.addEventListener("input", () => {
    state.jobAd = jobAd.value;
    fitError.hidden = true;
    updateCounter(jobAd, fitCounter, config.limits.jobAdMax);
    save();
  });

  // ------------------------------------------------------------ first draw

  input.value = state.draft;
  jobAd.value = state.jobAd;
  updateCounter(input, chatCounter, config.limits.chat);
  updateCounter(jobAd, fitCounter, config.limits.jobAdMax);
  renderMessages();
  renderFit();
  setMode(state.mode);
  root.classList.toggle("ai-open", state.open);
  root.classList.remove("ai-restoring");
  if (state.open) warmUp(config);
}
