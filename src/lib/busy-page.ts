import { site } from "@/config/site";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme-script";

/**
 * The page a visitor sees when the anti-scraping limiter (proxy.ts) pauses
 * them: status 429, served straight from the proxy, so it is a self-contained
 * HTML string (no React, no database, no external files). Branded, in the
 * site's light and dark palettes (the same `ar:theme` choice as the site, via
 * THEME_SCRIPT, else the device setting), with Back, a way to sign in (for a
 * visitor who isn't: signed-in buyers count against an allowance of their own)
 * and the office phone. A short pause ("One moment, please") leads with Try
 * again; a long one (an hourly or daily window) says the listings are paused
 * for a while and leads with signing in, since Try again would only bring this
 * page back. It names what was busy: the visitor's internet connection, or a
 * signed-in buyer's account, or the connection that every buyer signed in on
 * it shares.
 */

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** "in a minute", "in about 12 minutes", "in about 3 hours". */
export function waitPhrase(seconds: number): string {
  if (seconds <= 90) return "in a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `in about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** The URL to try again: the page asked for, without Next's `_rsc` cache-buster. */
export function retryHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("_rsc");
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

const tel = (phone: string) => `tel:+1${phone.replace(/\D/g, "")}`;

// Palettes: the same values as --color-* in src/app/globals.css.
const LIGHT = `--canvas:${THEME_COLORS.light};--surface:#ffffff;--ink:#15201c;--ink-soft:#3b4843;--muted:#66716c;--line:#e8e4db;--brand:#1a4c39;--brand-hover:#163d2f;--on-brand:#ffffff;--link:#1a4c39;color-scheme:light`;
const DARK = `--canvas:${THEME_COLORS.dark};--surface:#171e1b;--ink:#ecebe4;--ink-soft:#c9cdc5;--muted:#a0a8a1;--line:#252e2a;--brand:#2f7558;--brand-hover:#1f5d45;--on-brand:#ffffff;--link:#93d0b2;color-scheme:dark`;

/**
 * Up to this wait (seconds, the per-minute window) the pause is "a moment" and Try again
 * is the main action. Longer (an hourly or daily window, up to a day), Try again would only
 * show this page again, so the page says the listings are paused for a while and offers
 * signing in (signed-in buyers count against an allowance of their own) instead.
 */
export const SHORT_WAIT_S = 120;

/**
 * Whose allowance ran out: an anonymous visitor's connection; a signed-in buyer's own
 * account; or the allowance every buyer signed in on one connection shares (members:*).
 */
export type BusyFor = "visitor" | "account" | "members";

export function busyPageHtml(opts: {
  retryAfter: number;
  pathname: string;
  search: string;
  /** Whose allowance ran out (default: an anonymous visitor's). */
  busyFor?: BusyFor;
}) {
  const busyFor = opts.busyFor ?? "visitor";
  const signedIn = busyFor !== "visitor";
  const again = retryHref(opts.pathname, opts.search);
  const signIn = `/sign-in?next=${encodeURIComponent(again)}`;
  const short = opts.retryAfter <= SHORT_WAIT_S;
  const back = (cls: string) =>
    `<button class="btn ${cls}" type="button" data-testid="busy-back" onclick="if(history.length>1){history.back()}else{location.href='/'}">Back</button>`;
  const title = short ? "One moment, please" : "Listings are paused for now";
  const from = busyFor === "account" ? "your account" : "your internet connection";
  const shared =
    busyFor === "members" ? " Everyone signed in on this connection shares one allowance." : "";
  const why = short
    ? `We&#39;ve had a lot of page requests from ${from} in a short time, so we&#39;ve paused listings for a moment.${shared} This protects the listing data from automated copying.`
    : `We&#39;ve had a great many page requests from ${from}, so listings are paused there for a while.${shared} This protects the listing data from automated copying.`;
  const actions = short
    ? `<a class="btn primary" href="${esc(again)}" data-testid="busy-retry">Try again</a>
${back("secondary")}`
    : signedIn
      ? back("primary")
      : `<a class="btn primary" href="${esc(signIn)}" data-testid="busy-sign-in">Sign in to keep browsing</a>
${back("secondary")}`;
  const signInLine = signedIn
    ? ""
    : short
      ? `<p class="small">Have an account? <a href="${esc(signIn)}">Sign in</a> and keep browsing: signed-in buyers have an allowance of their own.</p>`
      : `<p class="small">Signed-in buyers browse on an allowance of their own. No account? <a href="/sign-up?next=${encodeURIComponent(again)}">Create one</a>; it&#39;s free.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}">
<title>${title} | ${esc(site.name)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<script>${THEME_SCRIPT}</script>
<style>
:root{${LIGHT}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--canvas);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:30rem;background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:32px 24px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:600;font-size:1.3rem;border-radius:8px}
.brand small{font-size:.65rem;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
h1{font-family:ui-serif,Georgia,"Times New Roman",serif;font-size:1.9rem;line-height:1.15;margin:28px 0 10px;font-weight:600}
p{margin:0 0 12px;color:var(--ink-soft)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 20px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:999px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;border:1px solid transparent}
.primary{background:var(--brand);color:var(--on-brand)}
.primary:hover{background:var(--brand-hover)}
.secondary{background:transparent;color:var(--ink);border-color:var(--line)}
.secondary:hover{background:var(--canvas)}
a{color:var(--link)}
a:focus-visible,.btn:focus-visible{outline:2px solid var(--link);outline-offset:3px}
.small{font-size:.9rem;color:var(--muted)}
.small a{font-weight:600}
@media (max-width:420px){.btn{flex:1 1 100%}}
</style>
</head>
<body>
<main>
<a class="brand" href="/" aria-label="${esc(site.name)} home">
<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#1a4c39"/><path d="M8 23.5 16 8.5l8 15" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.4 18h9.2" stroke="#c89b5a" stroke-width="2.4" stroke-linecap="round"/></svg>
<span>Adams <small>Realty</small></span>
</a>
<h1>${title}</h1>
<p>${why}</p>
<p>${short ? "Please try again" : "Listings open again here"} ${waitPhrase(opts.retryAfter)}.</p>
<div class="actions">
${actions}
</div>
${signInLine}
<p class="small">Questions? Call ${esc(site.legalName)} at <a href="${tel(site.phone)}" data-testid="busy-phone">${esc(site.phone)}</a>.</p>
</main>
</body>
</html>`;
}
