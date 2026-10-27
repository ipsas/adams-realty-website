import { eq, ne, sql } from "drizzle-orm";
import { site } from "@/config/site";
import { db as defaultDb, type Executor } from "@/db";
import { savedSearches, users } from "@/db/schema";
import { listUnsubscribeHeaders, sendEmail, type Email } from "@/lib/email";
import { absoluteUrl, savedHomesUpdateEmail, savedSearchAlertEmail } from "@/lib/email-templates";
import { gamlsLastSyncedAt } from "@/lib/mls/last-updated";
import { describeError } from "@/lib/mls/write-errors";
import {
  parseSearchParams,
  searchHref,
  serializeCriteria,
  type SearchCriteria,
} from "@/lib/search/params";
import { claimHomes, findHomeCandidates, loadHomeChanges, releaseHomes } from "./homes";
import { allocateRows, priceCutDetails, summarizeHomeEvents, toEmailListing } from "./present";
import { disclaimersFor, findSearchMatches } from "./queries";
import { alertWindows, CLAIM_LEASE_MS, isDue } from "./schedule";
import { HOME_ALERTS_SCOPE, unsubscribeUrls } from "./token";

/**
 * The alert job, run hourly by /api/cron/alerts:
 *
 * 1. Saved searches that are due (see schedule.ts) are evaluated one by one:
 *    claim (advance `last_alerted_at` to now, even if nothing matches), find
 *    new listings and price cuts in the window since the previous run, and
 *    send one email per search if there's anything to say.
 * 2. Saved homes with price or status changes since the user was last
 *    emailed get one digest per user; `last_notified_at` advances.
 *
 * Safe to re-run at any time: windows tile exactly, claims are atomic and
 * leased (overlapping runs skip each other's rows), and a failed send
 * releases its claim so the next run retries it. Work not started before the
 * deadline is left for the next run.
 */

export type AlertRunResult = {
  ok: boolean;
  searches: {
    due: number;
    evaluated: number;
    emailed: number;
    /** Claimed by an overlapping run. */
    skipped: number;
    failed: number;
    /** Not started before the deadline; the next run picks them up. */
    deferred: number;
  };
  homes: { users: number; emailed: number; skipped: number; failed: number; deferred: number };
  durationMs: number;
};

export type RunAlertsOptions = {
  db?: Executor;
  now?: Date;
  send?: (email: Email) => Promise<void>;
  /** Epoch ms after which no new work starts. */
  deadline?: number;
  timeZone?: string;
};

type SearchRow = {
  id: string;
  userId: string;
  name: string;
  criteria: SearchCriteria;
  alertFrequency: "instant" | "daily" | "weekly" | "off";
  lastAlertedAt: Date | null;
  createdAt: Date;
  email: string;
};

export async function runAlerts(opts: RunAlertsOptions = {}): Promise<AlertRunResult> {
  const started = Date.now();
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const send = opts.send ?? sendEmail;
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  const timeZone = opts.timeZone ?? site.market.timeZone;

  const result: AlertRunResult = {
    ok: true,
    searches: { due: 0, evaluated: 0, emailed: 0, skipped: 0, failed: 0, deferred: 0 },
    homes: { users: 0, emailed: 0, skipped: 0, failed: 0, deferred: 0 },
    durationMs: 0,
  };

  // --- Saved searches -----------------------------------------------------
  const searches: SearchRow[] = await db
    .select({
      id: savedSearches.id,
      userId: savedSearches.userId,
      name: savedSearches.name,
      criteria: savedSearches.criteria,
      alertFrequency: savedSearches.alertFrequency,
      lastAlertedAt: savedSearches.lastAlertedAt,
      createdAt: savedSearches.createdAt,
      email: users.email,
    })
    .from(savedSearches)
    .innerJoin(users, eq(users.id, savedSearches.userId))
    .where(ne(savedSearches.alertFrequency, "off"));
  const due = searches.filter((s) =>
    isDue(s.alertFrequency, s.lastAlertedAt ?? s.createdAt, now, timeZone),
  );
  result.searches.due = due.length;

  for (const search of due) {
    if (Date.now() > deadline) {
      result.searches.deferred++;
      continue;
    }
    try {
      const outcome = await processSearch(db, search, now, send);
      if (outcome === "skipped") result.searches.skipped++;
      else result.searches.evaluated++;
      if (outcome === "emailed") result.searches.emailed++;
    } catch (error) {
      result.searches.failed++;
      console.error(`[alerts] saved search ${search.id} failed: ${describeError(error)}`);
    }
  }

  // --- Saved homes --------------------------------------------------------
  const candidates = await findHomeCandidates(db, now);
  const byUser = new Map<string, { email: string; listingIds: string[] }>();
  for (const c of candidates) {
    const entry = byUser.get(c.userId) ?? { email: c.email, listingIds: [] };
    entry.listingIds.push(c.listingId);
    byUser.set(c.userId, entry);
  }
  result.homes.users = byUser.size;

  for (const [userId, { email, listingIds }] of byUser) {
    if (Date.now() > deadline) {
      result.homes.deferred++;
      continue;
    }
    try {
      const outcome = await processHomes(db, { userId, email, listingIds }, now, send);
      if (outcome === "skipped") result.homes.skipped++;
      if (outcome === "emailed") result.homes.emailed++;
    } catch (error) {
      result.homes.failed++;
      console.error(
        `[alerts] saved-home digest for user ${userId} failed: ${describeError(error)}`,
      );
    }
  }

  result.ok = result.searches.failed === 0 && result.homes.failed === 0;
  result.durationMs = Date.now() - started;
  return result;
}

/** Stored criteria may predate today's parser; round-trip them so stale keys can't break SQL. */
function normalizeCriteria(raw: SearchCriteria): SearchCriteria {
  return { ...parseSearchParams(serializeCriteria(raw ?? {})), page: 1 };
}

/**
 * Advances `last_alerted_at` to `now` and returns the previous value —
 * atomically, and only if no other run processed this search within
 * CLAIM_LEASE_MS. Null when the claim lost.
 */
async function claimSearch(
  db: Executor,
  id: string,
  now: Date,
): Promise<{ previous: Date | null } | null> {
  const lease = new Date(now.getTime() - CLAIM_LEASE_MS);
  const res = await db.execute<{ previous: Date | null }>(sql`
    update saved_searches s set last_alerted_at = ${now.toISOString()}::timestamptz
    from (select id, last_alerted_at from saved_searches where id = ${id}::uuid for update) prev
    where s.id = prev.id
      and (s.last_alerted_at is null or s.last_alerted_at < ${lease.toISOString()}::timestamptz)
    returning prev.last_alerted_at as previous`);
  const row = res.rows[0];
  return row ? { previous: row.previous ? new Date(row.previous) : null } : null;
}

async function releaseSearch(db: Executor, id: string, previous: Date | null, now: Date) {
  await db.execute(sql`
    update saved_searches set last_alerted_at = ${previous?.toISOString() ?? null}::timestamptz
    where id = ${id}::uuid and last_alerted_at = ${now.toISOString()}::timestamptz`);
}

async function processSearch(
  db: Executor,
  search: SearchRow,
  now: Date,
  send: (email: Email) => Promise<void>,
): Promise<"skipped" | "evaluated" | "emailed"> {
  const claim = await claimSearch(db, search.id, now);
  if (!claim) return "skipped";
  try {
    const criteria = normalizeCriteria(search.criteria);
    const windows = alertWindows({ createdAt: search.createdAt, lastRunAt: claim.previous, now });
    const m = await findSearchMatches(db, criteria, windows, now);
    if (!m.newTotal && !m.cutTotal) return "evaluated";

    const { newShown, cutsShown } = allocateRows(m.newRows.length, m.cutRows.length);
    const newRows = m.newRows.slice(0, newShown);
    const cutRows = m.cutRows.slice(0, cutsShown);
    const disclaimers = await disclaimersFor(
      db,
      [...newRows, ...cutRows].map((r) => r.sourceId),
    );
    const mlsUpdatedAt = await gamlsLastSyncedAt(db);
    const links = unsubscribeUrls({ userId: search.userId, scope: search.id });
    const frequency = search.alertFrequency === "off" ? "daily" : search.alertFrequency;

    const email = savedSearchAlertEmail({
      searchName: search.name,
      frequency,
      mode: criteria.mode,
      newListings: newRows.map((r) =>
        criteria.mode === "sold"
          ? toEmailListing(r, { badge: { label: "Sold", tone: "ink" } })
          : toEmailListing(r, {
              badge: { label: "New", tone: "brand" },
              notes: newListingNotes(r),
            }),
      ),
      newTotal: m.newTotal,
      priceCuts: cutRows.map((r) => toEmailListing(r, priceCutDetails(r.wasPrice, r))),
      priceCutTotal: m.cutTotal,
      searchUrl: absoluteUrl(searchHref({ ...criteria, sort: "newest", page: 1 })),
      unsubscribeUrl: links.page,
      manageUrl: absoluteUrl("/saved"),
      disclaimers,
      mlsUpdatedAt,
    });
    await send({
      to: search.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: listUnsubscribeHeaders(links.oneClick),
      idempotencyKey: `search-alert:${search.id}:${now.toISOString()}`,
    });
    return "emailed";
  } catch (error) {
    await releaseSearch(db, search.id, claim.previous, now).catch(() => {});
    throw error;
  }
}

/** A home listed and cut within one window keeps its "New" badge; the cut becomes a note. */
function newListingNotes(r: { wasPrice: number | null } & Parameters<typeof priceCutDetails>[1]) {
  const cut = priceCutDetails(r.wasPrice, r);
  return cut.badge ? [`${cut.badge.label} · ${cut.notes?.[0]}`] : undefined;
}

async function processHomes(
  db: Executor,
  user: { userId: string; email: string; listingIds: string[] },
  now: Date,
  send: (email: Email) => Promise<void>,
): Promise<"skipped" | "evaluated" | "emailed"> {
  const claimed = await claimHomes(db, user.userId, user.listingIds, now);
  if (!claimed.length) return "skipped";
  try {
    const changes = await loadHomeChanges(db, claimed, now);
    const homes = changes.flatMap(({ listing, events }) => {
      const summary = summarizeHomeEvents(events, listing);
      return summary ? [{ listing, summary }] : [];
    });
    if (!homes.length) return "evaluated";

    const disclaimers = await disclaimersFor(
      db,
      homes.map((h) => h.listing.sourceId),
    );
    const mlsUpdatedAt = await gamlsLastSyncedAt(db);
    const links = unsubscribeUrls({ userId: user.userId, scope: HOME_ALERTS_SCOPE });
    const email = savedHomesUpdateEmail({
      homes: homes.map((h) => toEmailListing(h.listing, h.summary)),
      savedUrl: absoluteUrl("/saved"),
      unsubscribeUrl: links.page,
      manageUrl: absoluteUrl("/account#alerts"),
      disclaimers,
      mlsUpdatedAt,
    });
    await send({
      to: user.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: listUnsubscribeHeaders(links.oneClick),
      idempotencyKey: `home-alert:${user.userId}:${now.toISOString()}`,
    });
    return "emailed";
  } catch (error) {
    await releaseHomes(db, user.userId, claimed, now).catch(() => {});
    throw error;
  }
}
