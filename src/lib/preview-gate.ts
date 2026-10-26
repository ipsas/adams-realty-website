import { safeNext } from "@/lib/safe-redirect";

/**
 * Preview gate: until the real Georgia MLS listings are connected, the public
 * must not see the sample listings. While `PREVIEW_PASSWORD` is set, `proxy.ts`
 * runs this first on every request (pages, route handlers, RSC fetches and
 * server actions):
 *
 * - A browser that entered the password on /preview carries the `adams_preview`
 *   cookie: HMAC-SHA256(key = BETTER_AUTH_SECRET, "preview-v1:" + password),
 *   checked in constant time with Web Crypto. It holds nothing but that proof,
 *   so changing the password signs every browser out of the preview.
 * - Without it, a page load (GET/HEAD) is sent to /preview?next=<where it was
 *   going>, the coming-soon page; anything else (form posts and server
 *   actions, /api/* including sign-in, sitemaps, files) gets a bare 401. The
 *   one exception under /api: a browser opening a link from an account email
 *   (/api/auth/reset-password/…, /api/auth/verify-email) is a page load too,
 *   so it reaches the coming-soon page and carries on after unlocking.
 * - Always reachable: /preview itself (and its unlock form's post),
 *   /api/cron/* (Vercel Cron; CRON_SECRET guards it), /robots.txt (which says
 *   `Disallow: /` while gated), the icons and the web app manifest, and the
 *   unsubscribe links in alert emails (/alerts/one-click, /alerts/unsubscribe):
 *   the cron keeps sending alerts, mail providers post the one-click
 *   unsubscribe from their own servers, and each checks its own signed token.
 *   While gated, those pages render without the site's header, tab bar and
 *   footer (src/app/(alerts)/layout.tsx, SiteChrome), as /preview does.
 * - Every response while gated says `X-Robots-Tag: noindex, nofollow` and
 *   `Cache-Control: private, no-store`, so no CDN or browser cache serves an
 *   unlocked page to the public, or the coming-soon page to a tester.
 *
 * Unset or empty, the gate is off and the site works as if it didn't exist.
 * Launch day: remove PREVIEW_PASSWORD (HANDOFF.md → launch checklist).
 *
 * Read from `process.env` on every call, like demo-data mode, so it holds in
 * the proxy, pages and tests alike. React-, Node- and database-free: the
 * proxy imports it.
 */

type EnvLike = Record<string, string | undefined>;

export const PREVIEW_PATH = "/preview";
export const PREVIEW_COOKIE = "adams_preview";
/** How long an unlocked browser stays unlocked, in seconds: 60 days. */
export const PREVIEW_COOKIE_MAX_AGE = 60 * 24 * 60 * 60;

/** The headers on every response while the gate is on. */
export const GATED_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
} as const;

/**
 * The preview password, or null when the gate is off (unset, empty or only spaces).
 * Surrounding spaces are ignored, here and in what people type (phones add them).
 */
export function previewPassword(e: EnvLike = process.env): string | null {
  const v = e.PREVIEW_PASSWORD?.trim();
  return v ? v : null;
}

const TOKEN_PREFIX = "preview-v1:";
const encoder = new TextEncoder();
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

const HEX_TOKEN = /^[0-9a-f]{64}$/;

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The cookie value that proves a browser knows `password`: 64 hex characters. */
export async function previewToken(password: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(TOKEN_PREFIX + password),
  );
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether a cookie value is the token for the current password. Web Crypto's HMAC verify
 * compares in constant time; a malformed value is refused before it.
 */
export async function verifyPreviewToken(
  token: string | null | undefined,
  password: string,
  secret: string,
): Promise<boolean> {
  if (!token || !HEX_TOKEN.test(token)) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    fromHex(token),
    encoder.encode(TOKEN_PREFIX + password),
  );
}

/**
 * Whether what someone typed is the password. Both sides are compared as their HMACs,
 * in constant time, so the check leaks neither the password nor its length.
 */
export async function previewPasswordMatches(
  typed: string,
  password: string,
  secret: string,
): Promise<boolean> {
  return verifyPreviewToken(await previewToken(typed.trim(), secret), password, secret);
}

/** Files and routes outside the gate, every method (see the module comment). */
const PUBLIC_FILES = new Set([
  PREVIEW_PATH,
  "/robots.txt",
  "/icon.svg",
  "/favicon.ico",
  "/manifest.webmanifest",
  // Alert emails' unsubscribe links (RFC 8058 one-click, and the footer link's confirm page
  // with its server action): authorized by their signed token. While gated the page stands
  // alone like /preview, without the site's header and footer (src/app/(alerts)/layout.tsx).
  "/alerts/one-click",
  "/alerts/unsubscribe",
]);
/**
 * Cron, and public files that hold no listing data (Next's static files, app icons, logos,
 * team photos, the MapLibre worker). The proxy's matcher skips the files already; listed for clarity.
 */
const PUBLIC_PREFIXES = [
  "/api/cron/",
  "/_next/static/",
  "/_next/image",
  "/icons/",
  "/brand/",
  "/team/",
  "/vendor/",
];

export function isPreviewExemptPath(path: string): boolean {
  return PUBLIC_FILES.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Pages drawn without the site's header, tab bar and footer, so they carry no links into the
 * site and nothing taken from the sample listings (the footer's towns, the demo notices): the
 * coming-soon page always, and while the gate is on (`gated`, whoever is viewing) the alert
 * emails' pages it leaves open to everyone, src/app/(alerts). Read by SiteChrome; the
 * (alerts) layout leaves out the footer on the same condition.
 */
export function standsAlone(path: string, gated: boolean): boolean {
  return path === PREVIEW_PATH || (gated && path.startsWith("/alerts/"));
}

/**
 * Where to go after unlocking: a same-site path (`safeNext`), never back to /preview
 * itself, else "/".
 */
export function previewNext(next: unknown): string {
  const path = safeNext(typeof next === "string" ? next : null);
  return path === PREVIEW_PATH || /^\/preview[/?#]/.test(path) ? "/" : path;
}

/** The coming-soon page, remembering where the visitor was going (nothing for "/"). */
export function previewUrl(next: string): string {
  const path = previewNext(next);
  return path === "/" ? PREVIEW_PATH : `${PREVIEW_PATH}?next=${encodeURIComponent(path)}`;
}

type HeaderLike = { get(name: string): string | null };

/** A route handler (/api/…), which the client router can't render as a page. */
export function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

/**
 * A page load the coming-soon page can stand in for: GET or HEAD, not the API, and not a
 * file (a sitemap, a script). Everything else is refused outright.
 *
 * The one API exception: a browser opening /api/auth/… itself (Sec-Fetch-Mode: navigate,
 * or an HTML Accept from browsers without Sec-Fetch), which is a link from an account email
 * such as the password reset or email verification. A fetch from a page never is.
 */
export function isPageRequest(method: string, path: string, headers?: HeaderLike): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (isApiPath(path)) return path.startsWith("/api/auth/") && isNavigation(headers);
  const last = path.slice(path.lastIndexOf("/") + 1);
  return !last.includes(".");
}

function isNavigation(headers: HeaderLike | undefined): boolean {
  const mode = headers?.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (headers?.get("accept") ?? "").includes("text/html");
}

export type GateDecision =
  /** No password configured: the gate does nothing. */
  | { action: "off" }
  /** Exempt, or an unlocked browser: carry on (with GATED_HEADERS). */
  | { action: "pass" }
  /** A page load: 307 to the coming-soon page. */
  | { action: "redirect"; location: string }
  /** Anything else: 401, no body worth reading. */
  | { action: "deny" };

type GateRequest = {
  method: string;
  nextUrl: { pathname: string; search: string };
  cookies: { get(name: string): { value: string } | undefined };
  headers?: HeaderLike;
};

export async function previewGate(
  request: GateRequest,
  password: string | null,
  secret: string,
): Promise<GateDecision> {
  if (!password) return { action: "off" };
  const { pathname, search } = request.nextUrl;
  if (isPreviewExemptPath(pathname)) return { action: "pass" };
  if (await verifyPreviewToken(request.cookies.get(PREVIEW_COOKIE)?.value, password, secret)) {
    return { action: "pass" };
  }
  if (isPageRequest(request.method, pathname, request.headers)) {
    return { action: "redirect", location: previewUrl(pathname + withoutRscParam(search)) };
  }
  return { action: "deny" };
}

/**
 * Next strips its RSC cache-busting `_rsc` parameter before the proxy runs (RSC fetches
 * otherwise look like page loads here); dropped again so `next` never carries one.
 */
function withoutRscParam(search: string): string {
  if (!/[?&]_rsc(=|&|$)/.test(search)) return search;
  const params = new URLSearchParams(search);
  params.delete("_rsc");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
