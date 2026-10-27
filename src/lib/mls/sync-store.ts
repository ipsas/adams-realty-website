import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, dataSources, listings, syncQuarantine, syncRuns } from "@/db/schema";
import { listingLabel, upsertListings, type PersistSource } from "@/lib/listings/persist";
import { pruneRemovedWhere, purgeCountQuery, purgeWhere } from "./purge";
import { describeQuarantine, quarantineLine, type SyncStore } from "./sync-engine";
import type { NormalizedListing } from "./types";
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

    async rejectionStreak() {
      const [row] = await db
        .select({
          failures: dataSources.rejectStreak,
          cursor: dataSources.rejectStreakCursor,
          key: dataSources.rejectStreakCursorKey,
        })
        .from(dataSources)
        .where(eq(dataSources.id, source.id));
      if (!row?.failures) return null;
      return {
        at: row.cursor ? { modifiedAt: row.cursor, key: row.key } : null,
        failures: row.failures,
      };
    },

    async recordRejection(at) {
      const cursor = at?.modifiedAt ?? null;
      const key = at?.key ?? null;
      // One statement: SET reads the row as it was, so the comparison sees the old position.
      const [row] = await db
        .update(dataSources)
        .set({
          rejectStreak: sql`case when ${dataSources.rejectStreak} > 0
            and ${dataSources.rejectStreakCursor} is not distinct from ${cursor}::timestamptz
            and ${dataSources.rejectStreakCursorKey} is not distinct from ${key}::text
            then ${dataSources.rejectStreak} + 1 else 1 end`,
          rejectStreakCursor: cursor,
          rejectStreakCursorKey: key,
        })
        .where(eq(dataSources.id, source.id))
        .returning({ failures: dataSources.rejectStreak });
      return { at, failures: row?.failures ?? 1 };
    },

    async quarantinedVersions(keys) {
      const rows = await db
        .select({ key: syncQuarantine.listingKey, at: syncQuarantine.modificationTimestamp })
        .from(syncQuarantine)
        .where(
          and(eq(syncQuarantine.sourceId, source.id), inArray(syncQuarantine.listingKey, keys)),
        );
      return new Map(rows.map((r) => [r.key, r.at]));
    },

    async ownClosedSyncedAt() {
      const [row] = await db
        .select({ at: dataSources.ownClosedSyncedAt })
        .from(dataSources)
        .where(eq(dataSources.id, source.id));
      return row?.at ?? null;
    },

    async recordOwnClosedSynced(at) {
      await db
        .update(dataSources)
        .set({ ownClosedSyncedAt: at })
        .where(eq(dataSources.id, source.id));
    },

    async writePage(page, cursor, { skipUnchanged, quarantine, maxQuarantined }) {
      agentIdsByMlsId ??= new Map(
        (
          await db
            .select({ id: agents.id, mlsAgentId: agents.mlsAgentId })
            .from(agents)
            .where(isNotNull(agents.mlsAgentId))
        ).map((a) => [a.mlsAgentId!, a.id]),
      );
      const agentMap = agentIdsByMlsId;
      // Logged once the page is committed: a rolled-back page skipped nothing.
      const logs: string[] = [];
      const outcome = await db.transaction(async (tx) => {
        const now = new Date();
        const rows = page.flatMap((item) => (item.ok ? [item.listing] : []));
        // Each attempt in a savepoint, so a rejected statement doesn't abort
        // the page's transaction: a record Postgres rejects is skipped, the
        // rest of the page is written and the cursor still advances. Too many
        // rejected (PageRejectedError) fails the page: this transaction rolls
        // back, cursor included, unless the page is being quarantined.
        const rejected: Array<{ n: NormalizedListing; reason: string }> = [];
        const { results, failed } = await writeIsolated(
          rows,
          (batch) =>
            tx.transaction((sp) =>
              upsertListings(sp, persistSource, batch, {
                agentIdsByMlsId: agentMap,
                skipUnchanged,
                now,
              }),
            ),
          (n, error) => rejected.push({ n, reason: describeError(error) }),
          { allowRejected: quarantine !== undefined, maxQuarantined },
        );
        for (const { n, reason } of rejected) {
          logs.push(
            quarantine
              ? quarantineLine(source.slug, n, reason)
              : `[mls] ${source.slug}: skipped ${listingLabel(n)}, which couldn't be written: ${reason}`,
          );
        }
        if (quarantine && rejected.length) {
          await tx
            .insert(syncQuarantine)
            .values(
              // One row per key: a key twice in one upsert would fail it.
              [...new Map(rejected.map((r) => [r.n.listingKey, r])).values()].map(
                ({ n, reason }) => ({
                  sourceId: source.id,
                  listingKey: n.listingKey,
                  mlsNumber: n.mlsNumber ?? null,
                  modificationTimestamp: n.sourceModifiedAt ?? null,
                  reason,
                  cursor: quarantine.at?.modifiedAt ?? null,
                  cursorKey: quarantine.at?.key ?? null,
                  firstSeenAt: now,
                  lastSeenAt: now,
                }),
              ),
            )
            .onConflictDoUpdate({
              target: [syncQuarantine.sourceId, syncQuarantine.listingKey],
              set: {
                mlsNumber: sql`excluded.mls_number`,
                modificationTimestamp: sql`excluded.modification_timestamp`,
                reason: sql`excluded.reason`,
                cursor: sql`excluded.cursor`,
                cursorKey: sql`excluded.cursor_key`,
                lastSeenAt: now,
              },
            });
          logs.push(
            `[mls] ALERT ${source.slug}: ${describeQuarantine(quarantine, rejected.length)}`,
          );
        }
        // Records stored now are out of quarantine (they were modified again).
        const failedKeys = new Set(failed.map((n) => n.listingKey));
        const stored = rows.map((n) => n.listingKey).filter((k) => !failedKeys.has(k));
        if (stored.length) {
          await tx
            .delete(syncQuarantine)
            .where(
              and(
                eq(syncQuarantine.sourceId, source.id),
                inArray(syncQuarantine.listingKey, stored),
              ),
            );
        }
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
          quarantined: quarantine ? failed.length : 0,
        };
      });
      for (const line of logs) console.error(line);
      return outcome;
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
      const [run] = await db
        .update(syncRuns)
        .set({
          ...outcome.counts,
          status: outcome.status,
          finishedAt: now,
          heartbeatAt: now,
          cursor: outcome.cursor,
          error: outcome.error ?? null,
        })
        .where(eq(syncRuns.id, runId))
        .returning({ mode: syncRuns.mode });
      if (outcome.status !== "failed") {
        await db
          .update(dataSources)
          // Caught up: the next run starts afresh, with the lookback. A sync
          // that didn't fail ends the rejection streak (a purge reads no page).
          .set({
            lastSyncedAt: now,
            ...(run?.mode !== "purge"
              ? { rejectStreak: 0, rejectStreakCursor: null, rejectStreakCursorKey: null }
              : {}),
            ...(outcome.caughtUp ? { syncCursorKey: null } : {}),
          })
          .where(eq(dataSources.id, source.id));
      }
      if (outcome.mapperVersion !== undefined) {
        // Merged into the jsonb, so the rest of the config is left as it is.
        const v = outcome.mapperVersion;
        await db
          .update(dataSources)
          .set({
            config:
              // A run that quarantined a page is `partial`, yet read the whole feed.
              outcome.status !== "failed" && outcome.caughtUp
                ? sql`(${dataSources.config} - 'remappingTo') || jsonb_build_object('mapperVersion', ${v}::int)`
                : sql`${dataSources.config} || jsonb_build_object('remappingTo', ${v}::int)`,
          })
          .where(eq(dataSources.id, source.id));
      }
    },
  };
}
