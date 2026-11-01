// Shapes shared by the AI panel's scripts and AiPanel.astro.

export type Mode = "ask" | "fit";
export type FitLabel = "strong" | "good" | "partial" | "weak";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Never sent to the AI as history: an error notice, or a question that got no answer. */
  error?: boolean;
  /** An error caused by usage limits: the notice gets a "Why?" link to the note about wait times. */
  limit?: boolean;
}

/** What /api/fit returns to the browser (role and company stay on the server). */
export interface FitResult {
  score: number;
  label: FitLabel;
  summary: string;
  strengths: { title: string; detail: string }[];
  gaps: { title: string; detail: string }[];
  highlights: { role: string; point: string }[];
}

/** Everything the panel needs from the page, passed in a data attribute. */
export interface PanelConfig {
  lang: "en" | "sv";
  name: string;
  title: string;
  email: string;
  siteUrl: string;
  limits: { chat: number; jobAdMin: number; jobAdMax: number };
  /** Public Turnstile site key (Cloudflare's test key until the real one is set). */
  turnstileSiteKey: string;
  strings: {
    tooShort: string;
    labels: Record<FitLabel, string>;
    whereMatch: string;
    gaps: string;
    relevant: string;
    fitScore: string;
    reportTitle: string;
    emailSubject: string;
    contact: string;
    generatedOn: string;
    /** Only used by `npm run dev`, where no Worker runs. */
    sampleReply: string;
    errorChat: string;
    errorFit: string;
    busy: string;
    /** "{s}" is replaced with the seconds left. */
    waitRetry: string;
    /** "{m}" is replaced with the minutes to wait. */
    busyLater: string;
    notJobAd: string;
    resting: string;
    tooFast: string;
    verifyFailed: string;
    /** "{n}" and "{max}" are replaced with the ad's length and the limit. */
    jobAdTooLong: string;
    /** The request is bigger than the AI plan takes at once. */
    tooLargeChat: string;
    tooLargeFit: string;
    /** Link text after a wait or limit notice, opening the note about wait times. */
    why: string;
  };
}
