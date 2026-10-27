import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dataSources } from "@/db/schema";
import { refreshPlaces } from "@/lib/listings/places";
import { ownOfficeIds } from "./gamls";
import { OFFICE_MIN_REMAINING_MS, officeLookupStore, refreshOffices } from "./office-lookup";
import { missingCredentials, ResoWebApiProvider } from "./reso/provider";
import { runSync, type RunSyncOptions, type SyncResult } from "./sync-engine";
import { createSyncStore } from "./sync-store";
import type { ListingProvider } from "./types";
import { describeError, SyncError } from "./write-errors";

export type { SyncMode, SyncResult } from "./sync-engine";

export type SyncOptions = Omit<RunSyncOptions, "now" | "sleep"> & {
  /** Injected in tests and benchmarks. */
  provider?: ListingProvider;
};

/**
 * How long past the run's `deadline` a feed request may still be in flight.
 * The engine only checks the deadline between pages, so the feed client cuts
 * off a request (or a retry wait) this long after it: the run then fails
 * cleanly, cursor saved and caches refreshed, before the function's own limit
 * (the cron's deadline is maxDuration − 45 s) kills it mid-write.
 */
export const FEED_GRACE_MS = 30_000;

export function createProvider(
  source: typeof dataSources.$inferSelect,
  opts: { deadline?: number } = {},
): ListingProvider {
  switch (source.kind) {
    case "reso_web_api":
      return new ResoWebApiProvider(source.config, process.env, {
        deadline: opts.deadline === undefined ? undefined : opts.deadline + FEED_GRACE_MS,
        ownOfficeIds: ownOfficeIds(source),
      });
    case "manual":
      throw new Error("Manual sources are edited in the dashboard and have nothing to sync.");
  }
}

/**
 * A sync that failed (the message is the cause's). `changed`: it wrote or
 * took down listings before failing, so caches still need refreshing.
 */
export class SyncFailedError extends SyncError {
  constructor(
    cause: unknown,
    readonly changed: boolean,
  ) {
    super(describeError(cause), { cause });
    this.name = "SyncFailedError";
  }
}

/**
 * Mirrors one MLS feed into our database (control flow in ./sync-engine.ts):
 *   - incremental (default): records modified since the stored cursor, page
 *     by page. Each page is written in one transaction together with the
 *     advanced cursor, so a run that stops (time budget, crash) resumes where
 *     it stopped. Unchanged records are skipped.
 *   - full: the whole feed, ignoring the cursor, and every record rewritten
 *     (the first load, or repairing rows after a mapper fix; CLI only).
 *   - purge: only removes listings that left the feed (IDX requires
 *     off-market listings to disappear promptly), within a removal cap.
 * A live-only source also re-reads the firm's own closed sales (purge and
 * full runs, and incremental ones every 20 hours: OWN_CLOSED_INTERVAL_MS).
 * Afterwards, if anything changed (even in a run that then failed), the
 * autocomplete places are rebuilt. The caller revalidates the page caches (it
 * may not be inside Next): on failure, a SyncFailedError says whether to.
 */
export async function syncSource(sourceId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId));
  if (!source) throw new Error(`Data source ${sourceId} not found`);
  const { provider, ...runOpts } = opts;
  const store = createSyncStore(source);
  let result: SyncResult;
  let feed: ListingProvider | undefined;
  try {
    result = await runSync(
      store,
      () => (feed = provider ?? createProvider(source, { deadline: runOpts.deadline })),
      // The source's config decides, after the caller's options, so they can't drop it.
      { ...runOpts, liveOnly: source.config.liveOnly === true },
    );
  } catch (e) {
    const changed = store.changedListings();
    if (changed) await refreshPlacesQuietly();
    throw new SyncFailedError(e, changed);
  }
  if (result.changed) await refreshPlacesQuietly();
  // Office names for listings the feed sent without one (best effort, never throws).
  const fetchOffices = feed?.fetchOffices?.bind(feed);
  const timeLeft = (runOpts.deadline ?? Infinity) - Date.now();
  if (fetchOffices && result.mode !== "purge" && timeLeft >= OFFICE_MIN_REMAINING_MS) {
    const named = await refreshOffices({
      fetchOffices,
      ...officeLookupStore(db, source.id),
      deadline: runOpts.deadline,
    });
    // New office names change the cached cards, so the caller's updateTag must run.
    if (named > 0 && !result.changed) return { ...result, changed: true };
  }
  return result;
}

/** Stale suggestions aren't worth failing a sync that already committed. */
async function refreshPlacesQuietly() {
  await refreshPlaces(db).catch((e) =>
    console.error(`Refreshing autocomplete places failed: ${describeError(e)}`),
  );
}

export type SourceSyncOutcome = { source: string } &
  /** `note`: why a source was skipped without a run (its credentials aren't set). */
  (
    | { ok: true; result: SyncResult; note?: string }
    /** `changed`: listings were written before it failed, so caches need refreshing too. */
    | { ok: false; error: string; changed: boolean }
  );

/**
 * Syncs every active feed source. Failures in one source don't stop the others.
 * A source whose credentials aren't set (e.g. no MLS_GAMLS_TOKEN yet) is
 * skipped with a `note`, without recording a run: it isn't a failure, and a
 * failed run every few minutes would only bury the real ones.
 */
export async function syncAllSources(
  opts: Omit<SyncOptions, "provider"> = {},
): Promise<SourceSyncOutcome[]> {
  const sources = await db
    .select({ id: dataSources.id, slug: dataSources.slug, config: dataSources.config })
    .from(dataSources)
    .where(and(eq(dataSources.isActive, true), eq(dataSources.kind, "reso_web_api")));
  const results: SourceSyncOutcome[] = [];
  for (const s of sources) {
    const missing = missingCredentials(s.config, process.env);
    if (missing) {
      console.warn(`[mls] ${s.slug} skipped: ${missing}`);
      results.push({
        source: s.slug,
        ok: true,
        note: missing,
        result: {
          fetched: 0,
          upserted: 0,
          unchanged: 0,
          removed: 0,
          runId: null,
          mode: opts.mode ?? "incremental",
          status: "skipped",
          skipped: {},
          cursor: null,
          mediaRowsWritten: 0,
          nulled: 0,
          quarantined: 0,
          pruned: 0,
          staleRunsFailed: 0,
          changed: false,
        },
      });
      continue;
    }
    try {
      results.push({ source: s.slug, ok: true, result: await syncSource(s.id, opts) });
    } catch (e) {
      const error = describeError(e);
      console.error(`[mls] ${s.slug} sync failed: ${error}`);
      results.push({
        source: s.slug,
        ok: false,
        error,
        changed: e instanceof SyncFailedError && e.changed,
      });
    }
  }
  return results;
}
