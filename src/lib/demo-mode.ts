/**
 * Demo-data mode: while the site runs on the fictional sample listings (the
 * seed), search engines must not index them. The agents are real, but their
 * pages list sample listings and stats. In this mode:
 *
 * - `proxy.ts` sends `X-Robots-Tag: noindex` on the pages that show sample
 *   data: search and listing pages, area guides, places and agent pages
 *   (`isDemoContentPath`);
 * - `robots.txt` disallows those paths and lists only the main sitemap;
 * - the sitemaps leave them out (the listing chunks and the areas sitemap are
 *   empty; the main sitemap keeps only the firm's own pages).
 *
 * One switch, `DEMO_DATA_MODE` (`on`/`off`, also `1`/`0`, `true`/`false`).
 * Unset, it follows `SEED_DEMO_DATA`: ON wherever the build loads the sample
 * data, OFF otherwise. Launch day: set `DEMO_DATA_MODE=off` (or remove
 * `SEED_DEMO_DATA`) and redeploy (HANDOFF.md → launch checklist).
 *
 * Read from `process.env` on every call, not from `env` (parsed once), so it
 * holds in the proxy, route handlers and tests alike. React- and database-free:
 * robots.ts and the sitemaps import it at build time.
 */

type EnvLike = Record<string, string | undefined>;

const ON = new Set(["1", "on", "true", "yes"]);
const OFF = new Set(["0", "off", "false", "no"]);

export function demoDataMode(e: EnvLike = process.env): boolean {
  const v = e.DEMO_DATA_MODE?.trim().toLowerCase();
  if (v && ON.has(v)) return true;
  if (v && OFF.has(v)) return false;
  return e.SEED_DEMO_DATA?.trim() === "1";
}

/** The sections that show sample data: listings and search, area guides, places, agent pages. */
export const DEMO_CONTENT_PATHS = ["/homes", "/areas", "/places", "/agents"] as const;

export function isDemoContentPath(path: string): boolean {
  return DEMO_CONTENT_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** The header value the proxy sends on those pages in demo mode. */
export const DEMO_ROBOTS_HEADER = "noindex, nofollow";
