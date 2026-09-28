import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { dataSources, syncRuns } from "@/db/schema";
import { purgeOverdue } from "@/lib/mls/purge";
import { PURGE_CAP_PREFIX, PURGE_SKIPPED_PREFIX } from "@/lib/mls/sync-engine";
import { syncSource } from "@/lib/mls/sync";
import type { ListingProvider, NormalizedListing } from "@/lib/mls/types";
import { closeDb, createSource, listing, resetDb } from "@/test/db/helpers";
import { getSources } from "./queries";

// The sources page's "no successful purge in 36 h" warning, from the runs the
// real sync writes: only a purge that succeeded resets its clock.

type Source = typeof dataSources.$inferSelect;
let source: Source;

beforeEach(async () => {
  await resetDb();
  source = await createSource();
});
afterAll(closeDb);

const HOUR = 3_600_000;

/** A one-page feed: `records` as updates, `activeKeys` as the purge's key list. */
function feed(records: NormalizedListing[], activeKeys = records.map((r) => r.listingKey)) {
  const provider: ListingProvider = {
    async *fetchUpdates() {
      yield {
        items: records.map((listing) => ({ ok: true as const, listing })),
        last: null,
      };
    },
    async *fetchActiveKeys() {
      yield activeKeys;
    },
  };
  return provider;
}

async function sourceRow() {
  const all = await getSources();
  const row = all.find((s) => s.id === source.id);
  if (!row) throw new Error("source missing from getSources()");
  return row;
}

describe("getSources: the purge clock", () => {
  it("counts only purges that succeeded: failed (capped or skipped) purges and syncs don't reset it", async () => {
    const records = Array.from({ length: 30 }, (_, i) => listing(i + 1));
    // The feed was first synced three days ago and last purged successfully 40 h ago.
    await syncSource(source.id, { provider: feed(records) });
    await db.update(syncRuns).set({ startedAt: new Date(Date.now() - 72 * HOUR) });
    const lastGoodPurge = new Date(Date.now() - 40 * HOUR);
    await db.insert(syncRuns).values({
      sourceId: source.id,
      mode: "purge",
      status: "succeeded",
      startedAt: new Date(lastGoodPurge.getTime() - 60_000),
      heartbeatAt: lastGoodPurge,
      finishedAt: lastGoodPurge,
    });

    // Since then: a purge stopped by the removal cap (28 of 30 gone from the feed)…
    await expect(
      syncSource(source.id, {
        mode: "purge",
        provider: feed(
          records,
          records.slice(0, 2).map((r) => r.listingKey),
        ),
      }),
    ).rejects.toThrow(PURGE_CAP_PREFIX);
    // …a purge that gave way to a sync still running (no time left to wait)…
    const [blocking] = await db
      .insert(syncRuns)
      .values({ sourceId: source.id, heartbeatAt: new Date() })
      .returning();
    await expect(
      syncSource(source.id, { mode: "purge", deadline: Date.now(), provider: feed(records) }),
    ).rejects.toThrow(PURGE_SKIPPED_PREFIX);
    await db.delete(syncRuns).where(eq(syncRuns.id, blocking.id));
    // …and a sync that succeeded.
    await syncSource(source.id, { provider: feed(records) });

    const failedPurges = await db.select().from(syncRuns).where(eq(syncRuns.status, "failed"));
    expect(failedPurges.map((r) => r.mode)).toEqual(["purge", "purge"]);
    expect(failedPurges.every((r) => r.finishedAt! > lastGoodPurge)).toBe(true);

    const row = await sourceRow();
    expect(row.lastPurgeAt?.getTime()).toBe(lastGoodPurge.getTime());
    expect(purgeOverdue(row, new Date())).toBe(true);

    // A purge that succeeds clears the warning.
    const purge = await syncSource(source.id, { mode: "purge", provider: feed(records) });
    expect(purge.status).toBe("succeeded");
    const after = await sourceRow();
    expect(after.lastPurgeAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(purgeOverdue(after, new Date())).toBe(false);
  });
});
