import { purgeCap, purgeScope, MAX_PURGE_FRACTION, PRUNE_REMOVED_AFTER_DAYS } from "./purge";
import { listingLabel } from "@/lib/listings/persist";
import type {
  FeedPosition,
  ListingProvider,
  MapResult,
  MapSkipReason,
  NormalizedListing,
  OwnClosedFeed,
  PurgeScope,
} from "./types";
import {
  describeError,
  PageRejectedError,
  QUARANTINE_AFTER_FAILURES,
  QUARANTINE_ESCALATE_AT_REFUSAL,
  QUARANTINE_MAX_PER_RUN,
  QuarantineRefusedError,
  SyncError,
} from "./write-errors";

/**
 * The sync's control flow — time budget, resume, purge rules — with no
 * database in it. `syncSource` (./sync.ts) runs it against Postgres through
 * `createSyncStore` (./sync-store.ts); unit tests run it against an in-memory
 * store and a fake feed (sync-engine.test.ts), and sync.db.test.ts runs it
 * against Postgres.
 */

export type SyncMode = "incremental" | "full" | "purge";

export type SyncCounts = {
  fetched: number;
  /** Records written (new or changed). */
  upserted: number;
  /** Records whose ModificationTimestamp matched the stored row: nothing written. */
  unchanged: number;
  /** Listings taken down: left the feed (purge) or opted out of display. */
  removed: number;
};

export type PageOutcome = {
  upserted: number;
  unchanged: number;
  removed: number;
  /** Records Postgres rejected (logged and skipped; the rest of the page was written). */
  failed: number;
  /** Rows written to listing_media and open_houses. */
  mediaRowsWritten: number;
  /** Values the sanitizer stored as null (unstorable numerics, ./sanitize.ts). */
  nulled: number;
  /** Records Postgres rejected on a quarantined page, kept in sync_quarantine (included in `failed`). */
  quarantined: number;
};

/**
 * Where the incremental sync is: the last record written, in the feed's
 * (ModificationTimestamp, ListingKey) order. `key` is null once a run has
 * caught up (see RunOutcome.caughtUp).
 */
export type SyncCursor = FeedPosition;

/**
 * Runs in a row that failed with PageRejectedError, or then with
 * QuarantineRefusedError, on the page starting at `at` (the saved cursor then;
 * null: the feed's start). A failure at another position starts a new streak;
 * a run that doesn't fail ends it once it got past `at` (pastStreak). Other errors (a lost connection, a timeout)
 * neither count nor end it. Runs 1–QUARANTINE_AFTER_FAILURES are rejections;
 * each later one is a refusal (refusalNumber), escalated at
 * QUARANTINE_ESCALATE_AT_REFUSAL. Kept in `data_sources.reject_streak*`.
 */
export type RejectionStreak = { at: SyncCursor | null; failures: number };

const samePosition = (a: SyncCursor | null, b: SyncCursor | null) =>
  a === null || b === null
    ? a === b
    : a.modifiedAt.getTime() === b.modifiedAt.getTime() && a.key === b.key;

/**
 * `a` is strictly after `b` in the feed's (ModificationTimestamp, ListingKey)
 * order. A null key (a caught-up cursor) is the end of its timestamp; a null
 * position is the feed's start.
 */
const isAfter = (a: SyncCursor | null, b: SyncCursor | null): boolean => {
  if (a === null) return false;
  if (b === null) return true;
  const dt = a.modifiedAt.getTime() - b.modifiedAt.getTime();
  if (dt !== 0) return dt > 0;
  if (b.key === null) return false;
  return a.key === null || a.key > b.key;
};

/** Which refusal (1…QUARANTINE_ESCALATE_AT_REFUSAL) a quarantine run at `streak` would be. */
export const refusalNumber = (streak: RejectionStreak) =>
  streak.failures - QUARANTINE_AFTER_FAILURES + 1;

/**
 * What admins are emailed (RunSyncOptions.alert) when a page due for
 * quarantine is refused, or when the refusal is escalated. No row values and
 * no listing keys: the cursor's timestamp, counts and the first error's class.
 */
export type SyncAlert = {
  mode: SyncMode;
  /** The refused page's position (cursor timestamp; null: the feed's start). */
  at: Date | null;
  /** Its position's listing key: only to tell positions apart (idempotency), never shown. */
  atKey: string | null;
  /** 1…QUARANTINE_ESCALATE_AT_REFUSAL. */
  refusal: number;
  /** The page was quarantined anyway and the cursor advanced. */
  escalated: boolean;
  rejected: number;
  total: number;
  /** errorClass of the first rejection. */
  firstErrorClass: string;
};

/** What a quarantining run logs (as an ALERT) and records as its run's message. */
export function describeQuarantine(streak: RejectionStreak, quarantined: number): string {
  const at = streak.at ? `${streak.at.modifiedAt.toISOString()}/${streak.at.key ?? "-"}` : "start";
  return (
    `page at cursor ${at} failed ${streak.failures} runs in a row; ` +
    `quarantined ${quarantined} rows (see sync_quarantine) and advanced`
  );
}

/** A quarantined record's log line: ids only, and the redacted reason. */
export function quarantineLine(slug: string, n: NormalizedListing, reason: string): string {
  return (
    `[mls] ${slug}: quarantined ${listingLabel(n)}, modified ` +
    `${n.sourceModifiedAt?.toISOString() ?? "unknown"}: ${reason}`
  );
}

export type RunOutcome = {
  status: "succeeded" | "partial" | "failed";
  counts: SyncCounts;
  /** The source's cursor as the run ends. */
  cursor: Date | null;
  /**
   * The run read the feed to its end. The next run starts afresh,
   * UPDATE_LOOKBACK_MS before the cursor; until then, a run continues exactly
   * after the cursor's record.
   */
  caughtUp: boolean;
  /**
   * The run got past the RejectionStreak's page: it caught up, wrote (or
   * quarantined) the page at the streak's cursor, or its cursor moved beyond
   * it. Only then does a run that didn't fail end the streak; a run stopped by
   * its time budget before reaching that page keeps it.
   */
  pastStreak: boolean;
  /**
   * The provider's mapper version, when this run rewrote every record it read
   * (a remap, or a full run). Caught up: it becomes the source's stored version.
   * Otherwise the remap is recorded as underway, so the next run resumes it.
   */
  mapperVersion?: number;
  error?: string;
};

/** See `DataSourceConfig.mapperVersion` / `remappingTo`. */
export type MapperVersions = { done: number | null; remappingTo: number | null };

/** Everything the engine needs from storage, bound to one data source. */
export interface SyncStore {
  /**
   * Marks this source's `running` runs with no heartbeat since `staleBefore`
   * as failed (their function was cut off), then starts a run, unless another
   * run is still alive, in which case `runId` is null.
   */
  beginRun(
    mode: SyncMode,
    staleBefore: Date,
  ): Promise<{ runId: string | null; staleFailed: number }>;
  /**
   * Records a run that didn't start because another run of this source was
   * still alive: `skipped`, or `failed` when that matters (a purge).
   */
  recordSkipped(mode: SyncMode, status: "skipped" | "failed", message: string): Promise<void>;
  /** The saved incremental cursor. */
  savedCursor(): Promise<SyncCursor | null>;
  /** The mapper version of the last caught-up remap, and of a remap still underway. */
  mapperVersions(): Promise<MapperVersions>;
  /** The current RejectionStreak, if any. */
  rejectionStreak(): Promise<RejectionStreak | null>;
  /**
   * Counts a run that failed with PageRejectedError on the page starting at
   * `at`: one more failure if the streak is at `at`, else a new streak of one.
   */
  recordRejection(at: SyncCursor | null): Promise<RejectionStreak>;
  /**
   * This source's quarantined records among `keys` (sync_quarantine): each
   * one's ListingKey and the ModificationTimestamp it was quarantined at.
   */
  quarantinedVersions(keys: string[]): Promise<Map<string, Date | null>>;
  /** When the own-closed pass last completed (`data_sources.own_closed_synced_at`); null: never. */
  ownClosedSyncedAt(): Promise<Date | null>;
  /** Records that the own-closed pass read all of the firm's closed sales at `at`. */
  recordOwnClosedSynced(at: Date): Promise<void>;
  /**
   * Writes one page and saves `cursor`, atomically. With `skipUnchanged`, a
   * record whose ModificationTimestamp matches the stored row isn't rewritten.
   * With `quarantine` (the streak of the runs that failed on this page), the
   * page never fails for its rejected rows: they're skipped, logged by id and
   * kept in sync_quarantine, and an ALERT is logged (describeQuarantine);
   * unless more than `maxQuarantined` of them, or all, are rejected: then it
   * throws QuarantineRefusedError and writes nothing (writeIsolated). With
   * `escalate` too (the refusal was escalated), it never refuses.
   * Every record written is taken out of sync_quarantine. Skipped records are
   * logged only once the page is committed.
   */
  writePage(
    page: MapResult[],
    cursor: SyncCursor | null,
    opts: {
      skipUnchanged: boolean;
      quarantine?: RejectionStreak;
      maxQuarantined?: number;
      escalate?: boolean;
    },
  ): Promise<PageOutcome>;
  /** Progress plus heartbeat, after every page. */
  heartbeat(runId: string, counts: SyncCounts): Promise<void>;
  /** In-scope listings, and how many of them are missing from `feedKeys`. */
  countPurge(feedKeys: string[], scope: PurgeScope): Promise<{ inScope: number; missing: number }>;
  /** Soft-removes the in-scope listings missing from `feedKeys`; returns how many. */
  purge(feedKeys: string[], scope: PurgeScope): Promise<number>;
  /**
   * Deletes for good this source's listings removed before `before` that no
   * lead or saved home references (`pruneRemovedWhere`); returns how many.
   */
  pruneRemoved(before: Date): Promise<number>;
  /**
   * Records the outcome; a run that didn't fail also stamps the source's last
   * sync (and, with `outcome.pastStreak`, ends the RejectionStreak), and one that caught
   * up clears the cursor's key. With
   * `outcome.mapperVersion`, saves it as done (caught up) or as underway.
   */
  finishRun(runId: string, outcome: RunOutcome): Promise<void>;
}

export type RunSyncOptions = {
  /**
   * Default "incremental". "full" ignores the cursor and rewrites every record
   * (after a mapper fix or a new column); "purge" only removes listings that
   * left the feed.
   */
  mode?: SyncMode;
  /**
   * Epoch ms. The run stops between pages when the next page (judged by the
   * slowest so far, plus half again) could end past it. An incremental run then ends
   * `partial` with its cursor saved, and the next run carries on from there.
   */
  deadline?: number;
  /** Lets a purge remove more than MAX_PURGE_FRACTION of the in-scope listings. */
  allowLargePurge?: boolean;
  /**
   * The source's feed only sends live statuses (`DataSourceConfig.liveOnly`), so the
   * purge compares every stored listing of the source (see `PurgeScope.liveOnly`).
   */
  liveOnly?: boolean;
  /** A `running` run with no heartbeat for this long was cut off. Default: the cron's maxDuration. */
  staleAfterMs?: number;
  /**
   * Emails admins about a refused or escalated quarantine (SyncAlert); syncSource
   * passes sendSyncAlert's. A failure is logged and never fails the run or
   * masks the refusal. Default: none.
   */
  alert?: (alert: SyncAlert) => Promise<void>;
  /** Injected clock and sleep (tests). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type SyncResult = SyncCounts & {
  runId: string | null;
  mode: SyncMode;
  /**
   * `skipped`: another run of this source was still going; nothing was done (recorded as such).
   * syncAllSources also reports a source without credentials as skipped (no run recorded).
   * `partial` also when the run quarantined a page (`quarantined`).
   */
  status: "succeeded" | "partial" | "skipped";
  /**
   * Records not written, by reason: the mapper's, `write_failed` for one
   * Postgres rejected (logged; the run carries on and the cursor moves past it,
   * unless too many of its page were rejected: see PageRejectedError), or
   * `still_quarantined` for one re-read unmodified since it was quarantined
   * (see stillQuarantined).
   */
  skipped: Partial<Record<MapSkipReason | "write_failed" | "still_quarantined", number>>;
  cursor: Date | null;
  mediaRowsWritten: number;
  /** Feed values the sanitizer stored as null instead (see PageOutcome.nulled). */
  nulled: number;
  /**
   * Records quarantined (also counted in `skipped.write_failed`): their page
   * failed QUARANTINE_AFTER_FAILURES runs in a row, so it was written without
   * them and the cursor moved past it (past QUARANTINE_MAX_PER_RUN when the
   * refusal was escalated). See sync_quarantine.
   */
  quarantined: number;
  /** Removed listings deleted for good after a purge (PRUNE_REMOVED_AFTER_DAYS). */
  pruned: number;
  /** Earlier runs found cut off and marked failed. */
  staleRunsFailed: number;
  /** Whether any listing changed, so caches need refreshing. */
  changed: boolean;
};

/** How much slower than the slowest page so far the next page may be (see runSync). */
const PAGE_TIME_SLACK = 1.5;

/** Vercel's maxDuration for the cron route; a run silent for longer is dead. */
export const STALE_RUN_MS = 300_000;

/**
 * A fresh incremental run re-reads this much of the feed before its cursor.
 * An MLS can make a record visible after we've read past its timestamp
 * (replication lag, a long transaction on their side); without the overlap
 * that update would be missed until the listing changed again. Re-reading an
 * unchanged record costs one read and no write.
 */
export const UPDATE_LOOKBACK_MS = 30 * 60_000;

/**
 * The own-closed pass of a live-only feed (`ListingProvider.ownClosed`): the
 * firm's own sales closed in the last PURGE_SOLD_DAYS, which the live-status
 * feed never sends, read on their own (a few dozen records) and written
 * through `writePage` like any page, rewriting every row (`skipUnchanged`
 * false) and passing the saved cursor unchanged, so the main feed's position
 * never moves. It runs in every purge (before the key download) and full run,
 * and in an incremental run once the last completed pass is this old (or
 * there was none), after the feed caught up. Its writes count in the run's
 * counts. A pass that fails (logged) or runs out of time stays due and never
 * fails the run.
 */
export const OWN_CLOSED_INTERVAL_MS = 20 * 3_600_000;

/**
 * A purge that finds another run of its source alive waits for it (skipping
 * would leave off-market listings up), polling this often, for at most
 * PURGE_MAX_WAIT_MS, and never so long that less than PURGE_RESERVE_MS of its
 * time budget is left for the key download itself.
 */
export const PURGE_WAIT_POLL_MS = 5_000;
export const PURGE_MAX_WAIT_MS = STALE_RUN_MS;
export const PURGE_RESERVE_MS = 120_000;

export const PURGE_CAP_PREFIX = "Purge cap:";
export const PURGE_SKIPPED_PREFIX = "Purge skipped:";

/**
 * The page without the records quarantined at their current
 * ModificationTimestamp (`held`: SyncStore.quarantinedVersions). The lookback
 * re-reads them on every run; they'd only be rejected again, and counted
 * towards the page's rejected fraction, failing runs over records already set
 * aside. A record modified since is written again (and leaves quarantine).
 */
export function stillQuarantined(
  items: MapResult[],
  held: Map<string, Date | null>,
): { items: MapResult[]; skipped: number } {
  const kept = items.filter((item) => {
    if (!item.ok) return true;
    const at = held.get(item.listing.listingKey);
    const modified = item.listing.sourceModifiedAt;
    return !(at && modified && at.getTime() === modified.getTime());
  });
  return { items: kept, skipped: items.length - kept.length };
}

export class PurgeCapError extends SyncError {
  constructor(
    readonly missing: number,
    readonly inScope: number,
    readonly cap: number,
  ) {
    super(
      `${PURGE_CAP_PREFIX} ${missing} of ${inScope} listings would be removed, more than ` +
        `${Math.round(MAX_PURGE_FRACTION * 100)}% (limit ${cap}), so nothing was removed. If the ` +
        `feed really dropped them, run \`npm run mls:sync -- --purge --allow-large-purge\`.`,
    );
    this.name = "PurgeCapError";
  }
}

export async function runSync(
  store: SyncStore,
  provider: ListingProvider | (() => ListingProvider),
  opts: RunSyncOptions = {},
): Promise<SyncResult> {
  const clock = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const mode = opts.mode ?? "incremental";
  const staleBefore = () => new Date(clock() - (opts.staleAfterMs ?? STALE_RUN_MS));

  let { runId, staleFailed } = await store.beginRun(mode, staleBefore());
  if (!runId && mode === "purge") {
    // IDX rules want off-market listings down promptly, so a purge doesn't
    // give way to a sync that happens to be running: it waits for it.
    const waitUntil = Math.min(
      clock() + PURGE_MAX_WAIT_MS,
      opts.deadline === undefined ? Infinity : opts.deadline - PURGE_RESERVE_MS,
    );
    while (!runId && clock() + PURGE_WAIT_POLL_MS <= waitUntil) {
      await sleep(PURGE_WAIT_POLL_MS);
      const next = await store.beginRun(mode, staleBefore());
      runId = next.runId;
      staleFailed += next.staleFailed;
    }
  }

  const counts: SyncCounts = { fetched: 0, upserted: 0, unchanged: 0, removed: 0 };
  const result: SyncResult = {
    ...counts,
    runId,
    mode,
    status: "skipped",
    skipped: {},
    cursor: null,
    mediaRowsWritten: 0,
    nulled: 0,
    quarantined: 0,
    pruned: 0,
    staleRunsFailed: staleFailed,
    changed: false,
  };
  if (!runId) {
    // Recorded either way, so a skipped run shows in the dashboard's run list.
    if (mode === "purge") {
      const error =
        `${PURGE_SKIPPED_PREFIX} another sync of this feed was still running, so nothing was ` +
        "removed. Off-market listings stay up until a purge runs: run " +
        "`npm run mls:sync -- --purge`, and check that the purge's cron doesn't overlap a sync.";
      await store.recordSkipped(mode, "failed", error);
      throw new SyncError(error);
    }
    await store.recordSkipped(
      mode,
      "skipped",
      "Skipped: another sync of this feed was still running. The next run carries on.",
    );
    return result;
  }

  // Stop between pages once the next page could end past the deadline: judged
  // by the slowest page so far, with half again as slack (page times vary).
  let slowest = 0;
  let pageStart = clock();
  const outOfTime = () => {
    const t = clock();
    slowest = Math.max(slowest, t - pageStart);
    pageStart = t;
    return opts.deadline !== undefined && t + slowest * PAGE_TIME_SLACK > opts.deadline;
  };

  let cursor: SyncCursor | null = null;
  let status: "succeeded" | "partial" = "succeeded";
  const cursorDate = () => cursor?.modifiedAt ?? null;
  // Set while the run rewrites every record for this mapper version, once the
  // saved cursor is this run's (so a later run may resume the remap from it).
  let remapVersion: number | undefined;
  let quarantineNote: string | undefined;
  // See RunOutcome.pastStreak.
  let passed = false;
  const activeRunId = runId;
  const sendAlert = async (alert: SyncAlert) => {
    if (!opts.alert) return;
    try {
      await opts.alert(alert);
    } catch (e) {
      console.error(`[mls] sync alert email failed: ${describeError(e)}`);
    }
  };
  const countFetched = (items: MapResult[]) => {
    counts.fetched += items.length;
    for (const item of items) {
      if (!item.ok) result.skipped[item.reason] = (result.skipped[item.reason] ?? 0) + 1;
    }
  };
  const countWritten = (outcome: PageOutcome) => {
    counts.upserted += outcome.upserted;
    counts.unchanged += outcome.unchanged;
    counts.removed += outcome.removed;
    if (outcome.failed) {
      result.skipped.write_failed = (result.skipped.write_failed ?? 0) + outcome.failed;
    }
    result.mediaRowsWritten += outcome.mediaRowsWritten;
    result.nulled += outcome.nulled;
  };
  try {
    const feed = typeof provider === "function" ? provider() : provider;
    cursor = await store.savedCursor();
    // The cursor as stored: the own-closed pass writes it back unchanged.
    let storedCursor = cursor;
    const ownClosed = opts.liveOnly ? (feed.ownClosed ?? null) : null;

    /** The own-closed pass (OWN_CLOSED_INTERVAL_MS). Never throws: a failure leaves it due. */
    const syncOwnClosed = async (own: OwnClosedFeed, onlyIfDue: boolean) => {
      try {
        if (onlyIfDue) {
          const last = await store.ownClosedSyncedAt();
          if (last && clock() - last.getTime() < OWN_CLOSED_INTERVAL_MS) return;
        }
        const { closedSince } = purgeScope(new Date(clock()));
        for await (const page of own.fetchUpdates(closedSince)) {
          countFetched(page.items);
          countWritten(await store.writePage(page.items, storedCursor, { skipUnchanged: false }));
          await store.heartbeat(activeRunId, counts);
          if (outOfTime()) return;
        }
        await store.recordOwnClosedSynced(new Date(clock()));
      } catch (error) {
        console.error(`[mls] own closed sales pass failed (still due): ${describeError(error)}`);
      }
    };

    if (mode === "purge") {
      // Before the key download, and only with the download's reserve still left.
      if (
        ownClosed &&
        (opts.deadline === undefined || clock() + PURGE_RESERVE_MS <= opts.deadline)
      ) {
        await syncOwnClosed(ownClosed, false);
      }
      const scope = purgeScope(new Date(clock()), { liveOnly: opts.liveOnly });
      const keys = new Set<string>();
      const fetchedBefore = counts.fetched;
      // A partial key list is never used: every page must arrive in time.
      const collect = async (pages: AsyncIterable<string[]>) => {
        for await (const page of pages) {
          for (const key of page) keys.add(key);
          counts.fetched = fetchedBefore + keys.size;
          await store.heartbeat(runId, counts);
          if (outOfTime()) {
            throw new SyncError(
              `Purge stopped: the feed's key list (${keys.size} keys so far) didn't finish downloading ` +
                "within the time budget, so nothing was removed. Run `npm run mls:sync -- --purge` from a workstation.",
            );
          }
        }
      };
      await collect(feed.fetchActiveKeys(scope));
      // An empty key list almost certainly means a feed outage, not an empty MLS.
      if (keys.size === 0) {
        throw new SyncError(
          "Purge stopped: the feed returned no listing keys (an outage?), so nothing was removed.",
        );
      }
      // Live-only: the firm's own sales closed within the window stay too.
      if (ownClosed) await collect(ownClosed.fetchKeys(scope.closedSince));
      const feedKeys = [...keys];
      const { inScope, missing } = await store.countPurge(feedKeys, scope);
      const cap = purgeCap(inScope);
      if (missing > cap && !opts.allowLargePurge) throw new PurgeCapError(missing, inScope, cap);
      counts.removed = missing > 0 ? await store.purge(feedKeys, scope) : 0;
      // Not capped: these rows are already off the site.
      result.pruned = await store.pruneRemoved(
        new Date(clock() - PRUNE_REMOVED_AFTER_DAYS * 86_400_000),
      );
    } else {
      // A run that stopped partway continues right after its last record; one
      // that caught up starts again a little before it (UPDATE_LOOKBACK_MS).
      let from: FeedPosition | null = cursor;
      // Stored rows mapped by an older mapper (`ListingProvider.mapperVersion`)
      // must be rewritten, though their ModificationTimestamp hasn't changed:
      // read the whole feed without skipping unchanged records until a run
      // catches up. A remap stopped partway resumes from its cursor.
      const version = feed.mapperVersion;
      let remap = mode === "full" && version !== undefined;
      let resumeRemap = false;
      if (mode === "incremental" && version !== undefined) {
        const saved = await store.mapperVersions();
        remap = saved.done !== version;
        resumeRemap = remap && saved.remappingTo === version && cursor?.key != null;
      }
      if (resumeRemap) {
        remapVersion = version;
      } else if (mode === "full" || remap) {
        from = null;
        cursor = null;
      } else if (cursor && cursor.key === null) {
        from = {
          modifiedAt: new Date(cursor.modifiedAt.getTime() - UPDATE_LOOKBACK_MS),
          key: null,
        };
      }
      // A page that failed runs in a row starts at the cursor they left: this run's first.
      const streak = await store.rejectionStreak();
      passed = streak === null;
      // A full run exists to repair stored rows, so it rewrites every one,
      // and retries quarantined ones (as does a remap).
      const skipUnchanged = mode !== "full" && !remap;
      for await (const page of feed.fetchUpdates(from)) {
        countFetched(page.items);
        // Only once the page is written: a failed page's run records the cursor before it.
        const next = page.last ?? cursor;
        const quarantine =
          streak && streak.failures >= QUARANTINE_AFTER_FAILURES && samePosition(streak.at, cursor)
            ? streak
            : undefined;
        let items = page.items;
        if (skipUnchanged) {
          const keys = items.flatMap((item) => (item.ok ? [item.listing.listingKey] : []));
          const held = keys.length ? await store.quarantinedVersions(keys) : new Map();
          const kept = stillQuarantined(items, held);
          items = kept.items;
          if (kept.skipped) {
            result.skipped.still_quarantined =
              (result.skipped.still_quarantined ?? 0) + kept.skipped;
          }
        }
        let outcome: PageOutcome;
        let escalated: number | undefined;
        try {
          outcome = await store.writePage(items, next, {
            skipUnchanged,
            quarantine,
            maxQuarantined: quarantine ? QUARANTINE_MAX_PER_RUN - result.quarantined : undefined,
          });
        } catch (error) {
          if (!(quarantine && error instanceof QuarantineRefusedError)) throw error;
          // Refused (QUARANTINE_MAX_PER_RUN, or a whole page rejected): held,
          // with admins emailed, until the refusal that escalates.
          const refusal = Math.min(refusalNumber(quarantine), QUARANTINE_ESCALATE_AT_REFUSAL);
          const alert: SyncAlert = {
            mode,
            at: cursor?.modifiedAt ?? null,
            atKey: cursor?.key ?? null,
            refusal,
            escalated: false,
            rejected: error.rejected,
            total: error.total,
            firstErrorClass: error.firstErrorClass,
          };
          if (refusal < QUARANTINE_ESCALATE_AT_REFUSAL) {
            await sendAlert(alert);
            throw error;
          }
          outcome = await store.writePage(items, next, {
            skipUnchanged,
            quarantine,
            escalate: true,
          });
          escalated = refusal;
          await sendAlert({ ...alert, escalated: true });
        }
        if (quarantine && outcome.quarantined) {
          result.quarantined += outcome.quarantined;
          quarantineNote = describeQuarantine(quarantine, outcome.quarantined);
          if (escalated) {
            quarantineNote += ` (refusal ${escalated} at this cursor escalated: quarantined regardless of the per-run cap)`;
          }
        }
        if (streak && (samePosition(streak.at, cursor) || isAfter(next, streak.at))) passed = true;
        cursor = next;
        storedCursor = next;
        if (remap) remapVersion = version;
        countWritten(outcome);
        await store.heartbeat(runId, counts);
        if (outOfTime()) {
          status = "partial";
          break;
        }
      }
      // An empty feed read from the start has caught up too.
      if (remap && status === "succeeded") remapVersion = version;
      // Only once the feed caught up in time; a full run always reads them.
      if (ownClosed && status === "succeeded") await syncOwnClosed(ownClosed, mode !== "full");
    }

    // A quarantine is reported (partial, with its note), though the run caught up.
    const reported = status === "succeeded" && result.quarantined ? "partial" : status;
    await store.finishRun(runId, {
      status: reported,
      counts,
      cursor: cursorDate(),
      caughtUp: mode !== "purge" && status === "succeeded",
      // A purge reads no page: it neither counts towards nor ends a streak.
      pastStreak: mode !== "purge" && (passed || status === "succeeded"),
      mapperVersion: remapVersion,
      error: quarantineNote,
    });
    Object.assign(result, counts, {
      status: reported,
      cursor: cursorDate(),
      changed: counts.upserted > 0 || counts.removed > 0,
    });
    return result;
  } catch (error) {
    // Only a page of rejected rows, or a refused quarantine of one, counts
    // towards a quarantine and its escalation, never a lost connection.
    if (
      (error instanceof PageRejectedError || error instanceof QuarantineRefusedError) &&
      mode !== "purge"
    ) {
      await store
        .recordRejection(cursor)
        .catch((e) => console.error(`[mls] recording a rejected page failed: ${describeError(e)}`));
    }
    await store.finishRun(runId, {
      status: "failed",
      counts,
      cursor: cursorDate(),
      caughtUp: false,
      pastStreak: false,
      mapperVersion: remapVersion,
      error: describeError(error),
    });
    throw error;
  }
}
