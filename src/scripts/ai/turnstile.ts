// Cloudflare Turnstile, the bot check (SPEC §7). Loaded only when the AI panel
// is first used. "interaction-only": the widget stays invisible unless
// Cloudflare wants the visitor to click a checkbox, which is rare.

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const LOAD_TIMEOUT_MS = 15_000;
/** Cloudflare's published test site key ("always passes"). */
export const TEST_SITE_KEY = "1x00000000000000000000AA";
/** The real site key only works on the live address, so local runs use the test key, which matches the test secret in .dev.vars. */
const isLocal = () => location.hostname === "localhost" || location.hostname === "127.0.0.1";
/** After a visitor ticks the box, Cloudflare leaves "Success!" on screen; hide it after a moment. */
const SUCCESS_SHOWN_MS = 1500;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;
let widgetId: string | null = null;
let waiting: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;

function load(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Turnstile took too long to load")), LOAD_TIMEOUT_MS);
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not start"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Turnstile could not be loaded"));
    };
    document.head.append(script);
  }).catch((err) => {
    loading = null; // try again next time
    throw err;
  });
  return loading;
}

/** A fresh single-use token (valid 5 minutes) for /api/session. */
export async function getToken(siteKey: string, lang: string, container: HTMLElement): Promise<string> {
  const turnstile = await load();
  clearTimeout(hideTimer);
  container.hidden = false; // the widget shows itself only if the visitor has to click
  return new Promise<string>((resolve, reject) => {
    waiting = { resolve, reject };
    const done = (fn: (w: NonNullable<typeof waiting>) => void) => {
      const w = waiting;
      waiting = null;
      if (w) fn(w);
      hideTimer = setTimeout(() => (container.hidden = true), SUCCESS_SHOWN_MS);
    };
    if (widgetId === null) {
      widgetId = turnstile.render(container, {
        sitekey: isLocal() ? TEST_SITE_KEY : siteKey,
        theme: "dark",
        size: "flexible",
        language: lang,
        appearance: "interaction-only",
        execution: "execute",
        "refresh-expired": "manual",
        callback: (token: string) => done((w) => w.resolve(token)),
        "error-callback": (code: string) => done((w) => w.reject(new Error(`Turnstile error ${code}`))),
        "timeout-callback": () => done((w) => w.reject(new Error("Turnstile challenge timed out"))),
      });
    } else {
      turnstile.reset(widgetId);
    }
    turnstile.execute(widgetId);
  });
}
