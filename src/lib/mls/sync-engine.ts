import { purgeCap, purgeScope, MAX_PURGE_FRACTION } from "./purge";
import type { ListingProvider, MapResult, MapSkipReason, PurgeScope } from "./types";

/**
 * The sync's control flow — time budget, resume, purge rules — with no
 * database in it. `syncSource` (./sync.ts) runs it against Postgres through
 * `createSyncStore` (./sync-store.ts); unit tests run it against an in-memory
 * store and a fake feed (sync-engine.test.ts).
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
  /** Rows written to listing_media and open_houses. */
  mediaRowsWritten: number;
};

export type RunOutcome = {
  status: "succeeded" | "partial" | "failed";
  counts: SyncCounts;
  /** The source's cursor as the run ends. */
  cursor: Date | null;
  error?: string;
};

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
  /** The saved incremental cursor. */
  savedCursor(): Promise<Date | null>;
  /** Writes one page and saves `cursor`, atomically. */
  writePage(page: MapResult[], cursor: Date | null): Promise<PageOutcome>;
  /** Progress plus heartbeat, after every page. */
  heartbeat(runId: string, counts: SyncCounts): Promise<void>;
  /** In-scope listings, and how many of them are missing from `feedKeys`. */
  countPurge(feedKeys: string[], scope: PurgeScope): Promise<{ inScope: number; missing: number }>;
  /** Soft-removes the in-scope listings missing from `feedKeys`; returns how many. */
  purge(feedKeys: string[], scope: PurgeScope): Promise<number>;
  /** Records the outcome; a run that didn't fail also stamps the source's last sync. */
  finishRun(runId: string, outcome: RunOutcome): Promise<void>;
}

export type RunSyncOptions = {
  /** Default "incremental". "full" ignores the cursor; "purge" only removes listings that left the feed. */
  mode?: SyncMode;
  /**
   * Epoch ms. The run stops between pages when the next page (judged by the
   * slowest so far, plus half again) could end past it. An incremental run then ends
   * `partial` with its cursor saved, and the next run carries on from there.
   */
  deadline?: number;
  /** Lets a purge remove more than MAX_PURGE_FRACTION of the in-scope listings. */
  allowLargePurge?: boolean;
  /** A `running` run with no heartbeat for this long was cut off. Default: the cron's maxDuration. */
  staleAfterMs?: number;
  /** Injected clock (tests). */
  now?: () => number;
};

export type SyncResult = SyncCounts & {
  runId: string | null;
  mode: SyncMode;
  /** `skipped`: another run of this source is still going; nothing was done. */
  status: "succeeded" | "partial" | "skipped";
  skipped: Partial<Record<MapSkipReason, number>>;
  cursor: Date | null;
  mediaRowsWritten: number;
  /** Earlier runs found cut off and marked failed. */
  staleRunsFailed: number;
  /** Whether any listing changed, so caches need refreshing. */
  changed: boolean;
};

/** How much slower than the slowest page so far the next page may be (see runSync). */
const PAGE_TIME_SLACK = 1.5;

/** Vercel's maxDuration for the cron route; a run silent for longer is dead. */
export const STALE_RUN_MS = 300_000;

export const PURGE_CAP_PREFIX = "Purge cap:";

export class PurgeCapError extends Error {
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
  const mode = opts.mode ?? "incremental";
  const { runId, staleFailed } = await store.beginRun(
    mode,
    new Date(clock() - (opts.staleAfterMs ?? STALE_RUN_MS)),
  );
  const counts: SyncCounts = { fetched: 0, upserted: 0, unchanged: 0, removed: 0 };
  const result: SyncResult = {
    ...counts,
    runId,
    mode,
    status: "skipped",
    skipped: {},
    cursor: null,
    mediaRowsWritten: 0,
    staleRunsFailed: staleFailed,
    changed: false,
  };
  if (!runId) return result;

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

  let cursor: Date | null = null;
  let status: "succeeded" | "partial" = "succeeded";
  try {
    const feed = typeof provider === "function" ? provider() : provider;
    cursor = await store.savedCursor();

    if (mode === "purge") {
      const scope = purgeScope(new Date(clock()));
      const keys = new Set<string>();
      let complete = true;
      for await (const page of feed.fetchActiveKeys(scope)) {
        for (const key of page) keys.add(key);
        counts.fetched = keys.size;
        await store.heartbeat(runId, counts);
        if (outOfTime()) {
          complete = false;
          break;
        }
      }
      if (!complete) {
        throw new Error(
          `Purge stopped: the feed's key list (${keys.size} keys so far) didn't finish downloading ` +
            "within the time budget, so nothing was removed. Run `npm run mls:sync -- --purge` from a workstation.",
        );
      }
      // An empty key list almost certainly means a feed outage, not an empty MLS.
      if (keys.size === 0) {
        throw new Error(
          "Purge stopped: the feed returned no listing keys (an outage?), so nothing was removed.",
        );
      }
      const feedKeys = [...keys];
      const { inScope, missing } = await store.countPurge(feedKeys, scope);
      const cap = purgeCap(inScope);
      if (missing > cap && !opts.allowLargePurge) throw new PurgeCapError(missing, inScope, cap);
      counts.removed = missing > 0 ? await store.purge(feedKeys, scope) : 0;
    } else {
      if (mode === "full") cursor = null;
      for await (const page of feed.fetchUpdates(cursor)) {
        counts.fetched += page.length;
        for (const item of page) {
          if (!item.ok) {
            result.skipped[item.reason] = (result.skipped[item.reason] ?? 0) + 1;
            continue;
          }
          const modified = item.listing.sourceModifiedAt;
          if (modified && (!cursor || modified > cursor)) cursor = modified;
        }
        const outcome = await store.writePage(page, cursor);
        counts.upserted += outcome.upserted;
        counts.unchanged += outcome.unchanged;
        counts.removed += outcome.removed;
        result.mediaRowsWritten += outcome.mediaRowsWritten;
        await store.heartbeat(runId, counts);
        if (outOfTime()) {
          status = "partial";
          break;
        }
      }
    }

    await store.finishRun(runId, { status, counts, cursor });
    Object.assign(result, counts, {
      status,
      cursor,
      changed: counts.upserted > 0 || counts.removed > 0,
    });
    return result;
  } catch (error) {
    await store.finishRun(runId, {
      status: "failed",
      counts,
      cursor,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
