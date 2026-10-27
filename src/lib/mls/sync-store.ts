import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, dataSources, listings, syncRuns } from "@/db/schema";
import { listingLabel, upsertListings, type PersistSource } from "@/lib/listings/persist";
import { pruneRemovedWhere, purgeCountQuery, purgeWhere } from "./purge";
import type { SyncStore } from "./sync-engine";
import { describeError, writeIsolated } from "./write-errors";

type SourceRow = typeof dataSources.$inferSelect;

export const STALE_RUN_ERROR =
  "Cut off: no progress within the function time limit (a timeout or crash). " +
  "Pages already written are kept; the next run resumes from the saved cursor.";

export type PostgresSyncStore = SyncStore & {
  /** Whether this store wrote or took down any listing, even in a run that then failed. */
  changedListings(): boolean;
};

/** The Postgres side of a sync, for one data source. */
export function createSyncStore(source: SourceRow): PostgresSyncStore {
  const persistSource: PersistSource = {
    id: source.id,
    slug: source.slug,
    kind: source.kind,
    config: source.config,
  };
  let agentIdsByMlsId: Map<string, string> | null = null;
  let changed = false;

  return {
    changedListings: () => changed,

    async beginRun(mode, staleBefore) {
      return db.transaction(async (tx) => {
        // Serializes run starts for this source across processes (cron, CLI, dashboard).
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`sync:${source.id}`}, 0))`,
        );
        const stale = await tx
          .update(syncRuns)
          .set({ status: "failed", finishedAt: new Date(), error: STALE_RUN_ERROR })
          .where(
            and(
              eq(syncRuns.sourceId, source.id),
              eq(syncRuns.status, "running"),
              sql`coalesce(${syncRuns.heartbeatAt}, ${syncRuns.startedAt}) < ${staleBefore}`,
            ),
          )
          .returning({ id: syncRuns.id });
        const [alive] = await tx
          .select({ id: syncRuns.id })
          .from(syncRuns)
          .where(and(eq(syncRuns.sourceId, source.id), eq(syncRuns.status, "running")))
          .limit(1);
        if (alive) return { runId: null, staleFailed: stale.length };
        const [run] = await tx
          .insert(syncRuns)
          .values({ sourceId: source.id, mode, heartbeatAt: new Date() })
          .returning({ id: syncRuns.id });
        return { runId: run.id, staleFailed: stale.length };
      });
    },

    async recordSkipped(mode, status, message) {
      const now = new Date();
      await db.insert(syncRuns).values({
        sourceId: source.id,
        mode,
        status,
        startedAt: now,
        heartbeatAt: now,
        finishedAt: now,
        error: message,
      });
    },

    async savedCursor() {
      const [row] = await db
        .select({ cursor: dataSources.syncCursor, key: dataSources.syncCursorKey })
        .from(dataSources)
        .where(eq(dataSources.id, source.id));
      return row?.cursor ? { modifiedAt: row.cursor, key: row.key } : null;
    },

    async mapperVersions() {
      const [row] = await db
        .select({ config: dataSources.config })
        .from(dataSources)
        .where(eq(dataSources.id, source.id));
      return {
        done: row?.config.mapperVersion ?? null,
        remappingTo: row?.config.remappingTo ?? null,
      };
    },

    async writePage(page, cursor, { skipUnchanged }) {
      agentIdsByMlsId ??= new Map(
        (
          await db
            .select({ id: agents.id, mlsAgentId: agents.mlsAgentId })
            .from(agents)
            .where(isNotNull(agents.mlsAgentId))
        ).map((a) => [a.mlsAgentId!, a.id]),
      );
      const agentMap = agentIdsByMlsId;
      return db.transaction(async (tx) => {
        const now = new Date();
        // Each attempt in a savepoint, so a rejected statement doesn't abort
        // the page's transaction: a record Postgres rejects is skipped, the
        // rest of the page is written and the cursor still advances. Too many
        // rejected (PageRejectedError) fails the page: this transaction rolls
        // back, cursor included.
        const { results, failed } = await writeIsolated(
          page.flatMap((item) => (item.ok ? [item.listing] : [])),
          (batch) =>
            tx.transaction((sp) =>
              upsertListings(sp, persistSource, batch, {
                agentIdsByMlsId: agentMap,
                skipUnchanged,
                now,
              }),
            ),
          (n, error) =>
            console.error(
              `[mls] ${source.slug}: skipped ${listingLabel(n)}, which couldn't be written: ` +
                describeError(error),
            ),
        );
        const written = new Set(results.filter((r) => r.written).map((r) => r.id));
        const untouched = new Set(results.filter((r) => !r.written).map((r) => r.id));

        // A listing that became non-displayable must come down.
        const takeDown = page.flatMap((item) =>
          !item.ok && item.reason === "not_displayable" && item.listingKey ? [item.listingKey] : [],
        );
        let removed = 0;
        if (takeDown.length) {
          const rows = await tx
            .update(listings)
            .set({ removedAt: now, updatedAt: now })
            .where(
              and(
                eq(listings.sourceId, source.id),
                inArray(listings.listingKey, takeDown),
                isNull(listings.removedAt),
              ),
            )
            .returning({ id: listings.id });
          removed = rows.length;
        }

        await tx
          .update(dataSources)
          .set({ syncCursor: cursor?.modifiedAt ?? null, syncCursorKey: cursor?.key ?? null })
          .where(eq(dataSources.id, source.id));
        if (written.size || removed) changed = true;
        return {
          upserted: written.size,
          unchanged: untouched.size,
          removed,
          failed: failed.length,
          mediaRowsWritten: results.reduce((n, r) => n + r.mediaRowsWritten, 0),
          nulled: results.reduce((n, r) => n + r.nulled, 0),
        };
      });
    },

    async heartbeat(runId, counts) {
      await db
        .update(syncRuns)
        .set({ ...counts, heartbeatAt: new Date() })
        .where(eq(syncRuns.id, runId));
    },

    async countPurge(feedKeys, scope) {
      // Keys are unique (the engine collects them in a Set), so the join can't multiply rows.
      const { rows } = await db.execute<{ inScope: number; missing: number }>(
        purgeCountQuery(source.id, feedKeys, scope),
      );
      return { inScope: rows[0]?.inScope ?? 0, missing: rows[0]?.missing ?? 0 };
    },

    async purge(feedKeys, scope) {
      const now = new Date();
      const result = await db
        .update(listings)
        .set({ removedAt: now, updatedAt: now })
        .where(purgeWhere(source.id, feedKeys, scope));
      if (result.rowCount) changed = true;
      return result.rowCount ?? 0;
    },

    async pruneRemoved(before) {
      // Media, open houses, listing events and daily views go with it (on delete cascade).
      const result = await db.delete(listings).where(pruneRemovedWhere(source.id, before));
      return result.rowCount ?? 0;
    },

    async finishRun(runId, outcome) {
      const now = new Date();
      await db
        .update(syncRuns)
        .set({
          ...outcome.counts,
          status: outcome.status,
          finishedAt: now,
          heartbeatAt: now,
          cursor: outcome.cursor,
          error: outcome.error ?? null,
        })
        .where(eq(syncRuns.id, runId));
      if (outcome.status !== "failed") {
        await db
          .update(dataSources)
          // Caught up: the next run starts afresh, with the lookback.
          .set(
            outcome.caughtUp ? { lastSyncedAt: now, syncCursorKey: null } : { lastSyncedAt: now },
          )
          .where(eq(dataSources.id, source.id));
      }
      if (outcome.mapperVersion !== undefined) {
        // Merged into the jsonb, so the rest of the config is left as it is.
        const v = outcome.mapperVersion;
        await db
          .update(dataSources)
          .set({
            config:
              outcome.status === "succeeded" && outcome.caughtUp
                ? sql`(${dataSources.config} - 'remappingTo') || jsonb_build_object('mapperVersion', ${v}::int)`
                : sql`${dataSources.config} || jsonb_build_object('remappingTo', ${v}::int)`,
          })
          .where(eq(dataSources.id, source.id));
      }
    },
  };
}
