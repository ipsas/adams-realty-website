import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { agents, dataSources, listings, syncRuns } from "@/db/schema";
import { upsertListing, type PersistSource } from "@/lib/listings/persist";
import { ResoWebApiProvider } from "./reso/provider";
import type { ListingProvider, MapSkipReason } from "./types";

export type SyncOptions = {
  /** Ignore the cursor and re-fetch everything. */
  full?: boolean;
  /** Also remove listings that have left the feed (heavier; run daily). */
  purge?: boolean;
  /** Injected in tests. */
  provider?: ListingProvider;
};

export type SyncResult = {
  runId: string;
  fetched: number;
  upserted: number;
  removed: number;
  skipped: Partial<Record<MapSkipReason, number>>;
};

export function createProvider(source: typeof dataSources.$inferSelect): ListingProvider {
  switch (source.kind) {
    case "reso_web_api":
      return new ResoWebApiProvider(source.config);
    case "manual":
      throw new Error("Manual sources are edited in the dashboard and have nothing to sync.");
  }
}

/**
 * Mirrors one MLS feed into our database:
 *   1. fetch records modified since the stored cursor, page by page
 *   2. upsert each page in a transaction and advance the cursor, so a crash
 *      mid-run resumes where it stopped instead of starting over
 *   3. optionally purge listings no longer in the feed (IDX requires
 *      off-market listings to disappear promptly)
 */
export async function syncSource(sourceId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId));
  if (!source) throw new Error(`Data source ${sourceId} not found`);

  const [run] = await db.insert(syncRuns).values({ sourceId }).returning({ id: syncRuns.id });
  const result: SyncResult = { runId: run.id, fetched: 0, upserted: 0, removed: 0, skipped: {} };

  try {
    const provider = opts.provider ?? createProvider(source);
    const persistSource: PersistSource = {
      id: source.id,
      slug: source.slug,
      kind: source.kind,
      config: source.config,
    };
    const agentRows = await db
      .select({ id: agents.id, mlsAgentId: agents.mlsAgentId })
      .from(agents)
      .where(isNotNull(agents.mlsAgentId));
    const agentIdsByMlsId = new Map(agentRows.map((a) => [a.mlsAgentId!, a.id]));

    let cursor = opts.full ? null : source.syncCursor;
    for await (const page of provider.fetchUpdates(cursor)) {
      result.fetched += page.length;
      await db.transaction(async (tx) => {
        for (const item of page) {
          if (!item.ok) {
            result.skipped[item.reason] = (result.skipped[item.reason] ?? 0) + 1;
            // A listing that became non-displayable must come down.
            if (item.reason === "not_displayable" && item.listingKey) {
              await tx
                .update(listings)
                .set({ removedAt: new Date() })
                .where(
                  and(eq(listings.sourceId, source.id), eq(listings.listingKey, item.listingKey)),
                );
            }
            continue;
          }
          await upsertListing(tx, persistSource, item.listing, { agentIdsByMlsId });
          result.upserted++;
          const modified = item.listing.sourceModifiedAt;
          if (modified && (!cursor || modified > cursor)) cursor = modified;
        }
        await tx
          .update(dataSources)
          .set({ syncCursor: cursor })
          .where(eq(dataSources.id, source.id));
      });
    }

    if (opts.purge) {
      const activeKeys = [...(await provider.fetchActiveKeys())];
      // An empty key list almost certainly means a feed outage, not an empty MLS.
      if (activeKeys.length > 0) {
        const removed = await db
          .update(listings)
          .set({ removedAt: new Date() })
          .where(
            and(
              eq(listings.sourceId, source.id),
              isNull(listings.removedAt),
              notInArray(listings.listingKey, activeKeys),
            ),
          )
          .returning({ id: listings.id });
        result.removed = removed.length;
      }
    }

    await db
      .update(dataSources)
      .set({ lastSyncedAt: new Date() })
      .where(eq(dataSources.id, source.id));
    await db
      .update(syncRuns)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        fetched: result.fetched,
        upserted: result.upserted,
        removed: result.removed,
      })
      .where(eq(syncRuns.id, run.id));
    return result;
  } catch (error) {
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        fetched: result.fetched,
        upserted: result.upserted,
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(syncRuns.id, run.id));
    throw error;
  }
}

/** Syncs every active feed source. Failures in one source don't stop the others. */
export async function syncAllSources(opts: Omit<SyncOptions, "provider"> = {}) {
  const sources = await db
    .select({ id: dataSources.id, slug: dataSources.slug })
    .from(dataSources)
    .where(and(eq(dataSources.isActive, true), eq(dataSources.kind, "reso_web_api")));
  const results: Array<
    { source: string } & ({ ok: true; result: SyncResult } | { ok: false; error: string })
  > = [];
  for (const s of sources) {
    try {
      results.push({ source: s.slug, ok: true, result: await syncSource(s.id, opts) });
    } catch (e) {
      results.push({
        source: s.slug,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
