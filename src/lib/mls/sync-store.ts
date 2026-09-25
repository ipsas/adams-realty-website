import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, dataSources, listings, syncRuns } from "@/db/schema";
import { upsertListings, type PersistSource } from "@/lib/listings/persist";
import { purgeCountQuery, purgeWhere } from "./purge";
import type { SyncStore } from "./sync-engine";

type SourceRow = typeof dataSources.$inferSelect;

export const STALE_RUN_ERROR =
  "Cut off: no progress within the function time limit (a timeout or crash). " +
  "Pages already written are kept; the next run resumes from the saved cursor.";

/** The Postgres side of a sync, for one data source. */
export function createSyncStore(source: SourceRow): SyncStore {
  const persistSource: PersistSource = {
    id: source.id,
    slug: source.slug,
    kind: source.kind,
    config: source.config,
  };
  let agentIdsByMlsId: Map<string, string> | null = null;

  return {
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

    async savedCursor() {
      const [row] = await db
        .select({ cursor: dataSources.syncCursor })
        .from(dataSources)
        .where(eq(dataSources.id, source.id));
      return row?.cursor ?? null;
    },

    async writePage(page, cursor) {
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
        const results = await upsertListings(
          tx,
          persistSource,
          page.flatMap((item) => (item.ok ? [item.listing] : [])),
          { agentIdsByMlsId: agentMap, skipUnchanged: true, now },
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
          .set({ syncCursor: cursor })
          .where(eq(dataSources.id, source.id));
        return {
          upserted: written.size,
          unchanged: untouched.size,
          removed,
          mediaRowsWritten: results.reduce((n, r) => n + r.mediaRowsWritten, 0),
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
          .set({ lastSyncedAt: now })
          .where(eq(dataSources.id, source.id));
      }
    },
  };
}
