import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dataSources } from "@/db/schema";
import { refreshPlaces } from "@/lib/listings/places";
import { ResoWebApiProvider } from "./reso/provider";
import { runSync, type RunSyncOptions, type SyncResult } from "./sync-engine";
import { createSyncStore } from "./sync-store";
import type { ListingProvider } from "./types";

export type { SyncMode, SyncResult } from "./sync-engine";

export type SyncOptions = Omit<RunSyncOptions, "now"> & {
  /** Injected in tests and benchmarks. */
  provider?: ListingProvider;
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
 * Mirrors one MLS feed into our database (control flow in ./sync-engine.ts):
 *   - incremental (default): records modified since the stored cursor, page
 *     by page. Each page is written in one transaction together with the
 *     advanced cursor, so a run that stops (time budget, crash) resumes where
 *     it stopped. Unchanged records are skipped.
 *   - full: the same, ignoring the cursor (the first load; CLI only).
 *   - purge: only removes listings that left the feed (IDX requires
 *     off-market listings to disappear promptly), within a removal cap.
 * Afterwards, if anything changed, the autocomplete places are rebuilt. The
 * caller revalidates the page caches (it may not be inside Next).
 */
export async function syncSource(sourceId: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId));
  if (!source) throw new Error(`Data source ${sourceId} not found`);
  const { provider, ...runOpts } = opts;
  const result = await runSync(
    createSyncStore(source),
    () => provider ?? createProvider(source),
    runOpts,
  );
  if (result.changed) {
    // Stale suggestions aren't worth failing a sync that already committed.
    await refreshPlaces(db).catch((e) =>
      console.error("Refreshing autocomplete places failed:", e),
    );
  }
  return result;
}

export type SourceSyncOutcome = { source: string } & (
  { ok: true; result: SyncResult } | { ok: false; error: string }
);

/** Syncs every active feed source. Failures in one source don't stop the others. */
export async function syncAllSources(
  opts: Omit<SyncOptions, "provider"> = {},
): Promise<SourceSyncOutcome[]> {
  const sources = await db
    .select({ id: dataSources.id, slug: dataSources.slug })
    .from(dataSources)
    .where(and(eq(dataSources.isActive, true), eq(dataSources.kind, "reso_web_api")));
  const results: SourceSyncOutcome[] = [];
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
