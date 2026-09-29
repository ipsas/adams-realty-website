import {
  browserSessionStorage,
  type KeyValueStorage,
  readJSON,
  remove,
  SESSION_KEYS,
  writeJSON,
} from "@/lib/local-store";

/**
 * "Back to results", "All leads" and "Back to listings": a detail page's link
 * back to the list it came from. When the page was opened from that list in
 * this tab, the link acts like Back (so the list comes back exactly as it
 * was: scroll, tab, filters). Otherwise (a shared link, a bookmark, another
 * page) it goes to the last list of that kind seen in this tab, or the plain
 * list.
 *
 * The list page marks the hand-off when one of its detail links is followed
 * (`markReturn`); the detail page takes the mark once (`takeReturn`) and
 * stamps its own history entry, so a reload or a Back/Forward to it still
 * knows. Pure except for storage, which tests inject.
 */

export type ReturnScope = "search" | "leads" | "listings";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const SCOPES: Record<ReturnScope, { list: RegExp; detail: RegExp }> = {
  search: { list: /^\/homes$/, detail: /^\/homes\/[\w-]+$/ },
  leads: { list: /^\/dashboard\/leads$/, detail: new RegExp(`^/dashboard/leads/${UUID}$`, "i") },
  listings: {
    list: /^\/dashboard\/listings$/,
    detail: new RegExp(`^/dashboard/listings/(new|${UUID})$`, "i"),
  },
};

/** A mark is only good for a quick hand-off (a slow page load, not a later visit). */
export const RETURN_MARK_MAX_AGE_MS = 5 * 60 * 1000;

type Deps = { storage?: KeyValueStorage | null; now?: number };
type Mark = { from: string; to: string; at: number };

function parse(pathAndQuery: string): URL | null {
  if (typeof pathAndQuery !== "string" || !pathAndQuery.startsWith("/")) return null;
  if (pathAndQuery.startsWith("//") || /[\s\\#]/.test(pathAndQuery)) return null;
  try {
    const url = new URL(pathAndQuery, "http://x");
    return url.origin === "http://x" ? url : null;
  } catch {
    return null;
  }
}

/** Is this "/path?query" one of `scope`'s list pages? */
export function isListUrl(scope: ReturnScope, pathAndQuery: string): boolean {
  const url = parse(pathAndQuery);
  return !!url && SCOPES[scope].list.test(url.pathname);
}

/** Is this pathname one of `scope`'s detail pages? */
export function isDetailPath(scope: ReturnScope, pathname: string): boolean {
  const url = parse(pathname);
  return !!url && !url.search && SCOPES[scope].detail.test(url.pathname);
}

/** A list page hands off to a detail page (`to` is its pathname). */
export function markReturn(
  scope: ReturnScope,
  from: string,
  to: string,
  { storage = browserSessionStorage(), now = Date.now() }: Deps = {},
): void {
  if (!isListUrl(scope, from) || !isDetailPath(scope, to)) return;
  writeJSON(SESSION_KEYS.returnTo + scope, { from, to, at: now } satisfies Mark, storage);
}

/**
 * On a detail page: the list URL it was just opened from, or null. The mark is
 * removed either way, so the next visit to this page from elsewhere doesn't
 * inherit it.
 */
export function takeReturn(
  scope: ReturnScope,
  pathname: string,
  { storage = browserSessionStorage(), now = Date.now() }: Deps = {},
): string | null {
  const key = SESSION_KEYS.returnTo + scope;
  const mark = readJSON<Partial<Mark> | null>(key, null, storage);
  if (!mark) return null;
  if (mark.to !== pathname) return null;
  remove(key, storage);
  if (typeof mark.at !== "number" || now - mark.at > RETURN_MARK_MAX_AGE_MS || mark.at > now)
    return null;
  return typeof mark.from === "string" && isListUrl(scope, mark.from) ? mark.from : null;
}

/** Remembers the list URL on screen (dashboard scopes; search keeps its own last search). */
export function rememberList(
  scope: ReturnScope,
  pathAndQuery: string,
  { storage = browserSessionStorage() }: Deps = {},
): void {
  if (isListUrl(scope, pathAndQuery))
    writeJSON(SESSION_KEYS.lastList + scope, pathAndQuery, storage);
}

/** The last list URL of `scope` seen in this tab, or null. */
export function lastList(
  scope: ReturnScope,
  { storage = browserSessionStorage() }: Deps = {},
): string | null {
  const v = readJSON<unknown>(SESSION_KEYS.lastList + scope, null, storage);
  return typeof v === "string" && isListUrl(scope, v) ? v : null;
}

/* ───────────── the stamp on the detail page's own history entry ───────────── */

const STAMP = "__arReturn";

/** The list this history entry was opened from, if it was stamped. */
export function readStamp(scope: ReturnScope, state: unknown): string | null {
  const stamps = (state as Record<string, unknown> | null)?.[STAMP];
  const from = (stamps as Record<string, unknown> | undefined)?.[scope];
  return typeof from === "string" && isListUrl(scope, from) ? from : null;
}

/** `state` plus the stamp; spreading keeps Next's own keys, so its router ignores the change. */
export function withStamp(
  scope: ReturnScope,
  from: string,
  state: unknown,
): Record<string, unknown> {
  const base = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  const stamps = (base[STAMP] && typeof base[STAMP] === "object" ? base[STAMP] : {}) as Record<
    string,
    string
  >;
  return { ...base, [STAMP]: { ...stamps, [scope]: from } };
}
