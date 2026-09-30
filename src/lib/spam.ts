/**
 * Spam signals for the public forms (tour/question/contact, valuation,
 * listing reports, sign-up, saved searches). Pure: the forms add the fields
 * (src/components/ui/spam-guard.tsx), the server reads them here, and the
 * counting lives in ./form-guard.ts.
 *
 * - Honeypot: a field people never see or fill (`website`). Form-filling
 *   robots fill every field.
 * - Time to submit: when the form opens, the page fetches a signed token of
 *   the server's time (`formToken`, ./form-token.ts) and sends it back with the
 *   form; the server measures from it on its own clock, so the visitor can't
 *   claim a time. A form sent faster than a person can read and type, or with
 *   no valid token (posted straight to the server, not from the page), is
 *   suspect; so is a lead on a token that already carried several
 *   (FORM_TOKEN_MAX_LEADS).
 * - Content: the SEO pitches the office already received through the site
 *   ("your site isn't in Google's index", "improve your search visibility",
 *   with a link). Only from senders who aren't customers.
 *
 * Suspected spam is kept, flagged, and never emailed (src/lib/leads/submit.ts).
 */

export const HONEYPOT_FIELD = "website";
/** The form's timer token (./form-token.ts), from GET /api/form-token. */
export const FORM_TOKEN_FIELD = "formToken";
/**
 * A page whose timer token is older than this when it comes back into view fetches a
 * fresh one (`useFormTimer`), well before the token's day is up (FORM_TOKEN_MAX_AGE_MS).
 */
export const FORM_TOKEN_REFRESH_MS = 12 * 3_600_000;
/** The header sign-up sends the token in, since Better Auth's body is its own. */
export const FORM_TOKEN_HEADER = "x-form-token";

/** Minimum time, in ms, a person needs between the form appearing and sending it. */
export const MIN_FILL_MS = {
  /** Tour, question, contact, valuation and report forms: at least a name and an email to type. */
  message: 3_000,
  /** Name, email and a password. */
  signUp: 2_000,
  /** The save-search dialog comes pre-filled; timed from when the search page opened. */
  saveSearch: 2_000,
} as const;

export type SpamReason = "honeypot" | "too-fast" | "no-timer" | "reused-timer" | "seo-pitch";

/** How the dashboard explains each reason. */
export const SPAM_REASON_LABELS: Record<SpamReason, string> = {
  honeypot: "Filled in a hidden field that people never see",
  "too-fast": "Sent seconds after the form opened, faster than a person types",
  "no-timer": "Sent straight to the server, not from the form on the page",
  "reused-timer": "Sent with a form timer already used for several messages, as scripts do",
  "seo-pitch": "An SEO or search-ranking sales pitch from someone the office hasn't worked with",
};

export const isSpamReason = (v: string): v is SpamReason => v in SPAM_REASON_LABELS;

/** Parses the reasons stored on a lead (`metadata.spam`, comma-separated). */
export function parseSpamReasons(value: string | null | undefined): SpamReason[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isSpamReason);
}

/**
 * The honeypot and timing reasons for one submission. `elapsedMs` is what the server
 * measured from the form's token (`formTokenElapsed`): null when there was no valid one.
 */
export function formSignals(input: {
  honeypot: string | null | undefined;
  elapsedMs: number | null;
  minMs: number;
}): SpamReason[] {
  const reasons: SpamReason[] = [];
  if (input.honeypot?.trim()) reasons.push("honeypot");
  if (input.elapsedMs === null) reasons.push("no-timer");
  else if (input.elapsedMs < input.minMs) reasons.push("too-fast");
  return reasons;
}

/** Phrases from SEO sales pitches. Each one found is a hit. */
const SEO_PATTERNS: RegExp[] = [
  // Upper case only: "Seo" is also a Korean name.
  /\bSEO\b/,
  /search[- ]engine (optimi[sz]ation|rankings?|results|visibility)/i,
  /\bsearch (visibility|rankings?)\b/i,
  /\bgoogle['’]?s? (index|search results|first page|rankings?)\b/i,
  /\b(first|top|1st) page (of|on) google\b/i,
  /\bpage (one|1) (of|on) google\b/i,
  /\b(not|n['’]t) (showing up|appearing|visible|indexed|ranking|ranked)\b[^.!?\n]{0,30}\b(google|search)/i,
  /\bindexed (on|by|in) google\b|\bgoogle index(ing)?\b/i,
  /\bbacklinks?\b/i,
  /\borganic (traffic|rankings?|leads|reach)\b/i,
  /\bdomain authority\b/i,
  /\b(website|web site|site) (traffic|redesign|audit)\b/i,
  /\bdigital marketing\b/i,
  /\bguest post/i,
];

const LINK = /\bhttps?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/gi;

export function countLinks(text: string): number {
  return text.match(LINK)?.length ?? 0;
}

export function seoHits(text: string): number {
  return SEO_PATTERNS.filter((re) => re.test(text)).length;
}

/**
 * An SEO pitch: an SEO phrase and a link, or two different SEO phrases.
 * Callers apply it only to senders who aren't customers.
 */
export function isSeoPitch(text: string | null | undefined): boolean {
  if (!text) return false;
  const hits = seoHits(text);
  return (hits >= 1 && countLinks(text) >= 1) || hits >= 2;
}
