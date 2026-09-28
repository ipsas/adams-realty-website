/**
 * Shared settings for the dev-only performance harness (`npm run perf:*`).
 * Everything here runs against its own database, `adams_perf`, never the
 * app's: the harness refuses any other database name.
 */
export const PERF_DB = "adams_perf";

/** Server URL (any database on it); override with PERF_DATABASE_URL. */
export const PERF_URL =
  process.env.PERF_DATABASE_URL ?? `postgres://adams:adams@localhost:5432/${PERF_DB}`;

export function assertPerfUrl(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name !== PERF_DB) {
    throw new Error(`refusing to run: the perf harness only touches "${PERF_DB}", got "${name}"`);
  }
  return url;
}

/** The same server's maintenance database, for CREATE/DROP DATABASE. */
export function adminUrl(url: string): string {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

/** The small-box fixture: rural south Georgia, 48+ km from every generated town. */
export const SMALL_BOX = { west: -82.87, south: 31.33, east: -82.83, north: 31.37 };
