/**
 * Drives the real MLS sync (`syncSource`, with a fake feed injected) and the
 * listing sitemap against `adams_perf` (build it with `npm run perf:seed`).
 * Dev-only; it writes to adams_perf and puts back what it removes.
 *
 *   npm run perf:sync-bench              # all scenarios, prints the numbers
 *   npm run perf:sync-bench -- --check   # …and exits 1 if a target is missed
 *
 * Scenarios and targets (GA-C2 acceptance):
 * - incremental: 300 changed records (a price cut each) → under 5 s of
 *   database time, at most 1 statement per listing, no media rewritten
 * - unchanged: the same 300 records again → 0 rows and 0 media written
 * - deadline: 10,000 records in 50 slow pages against a short budget → the
 *   run ends `partial` before the deadline, and the next run finishes
 * - purge: 100,000 feed keys (past Postgres's 65,535 bind parameters), 1% of
 *   the feed gone → removed in one statement
 * - purge cap: 10% gone → aborts, removes nothing, records a failed run
 * - sitemap: every chunk ≤ 10,000 URLs and < 4 MB of XML; together they list
 *   every live listing exactly once
 */
import pg from "pg";
import { assertPerfUrl, PERF_URL } from "./perf-db";

const url = assertPerfUrl(PERF_URL);
// Must be set before anything imports @/db (it reads the URL once).
process.env.DATABASE_URL = url;
process.env.NEXT_PUBLIC_SITE_URL ??= "https://www.example.com";
const check = process.argv.includes("--check");

// Counts every statement sent on any pooled connection (transactions included).
let statements = 0;
const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
const originalQuery = proto.query;
proto.query = function (this: unknown, ...args: unknown[]) {
  statements++;
  return originalQuery.apply(this, args);
};

const failures: string[] = [];
function expectThat(label: string, ok: boolean, detail = "") {
  console.info(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function main() {
  const { db } = await import("@/db");
  const { dataSources, listingMedia, listings, syncRuns } = await import("@/db/schema");
  const { and, asc, desc, eq, inArray, isNull, sql } = await import("drizzle-orm");
  const { syncSource } = await import("@/lib/mls/sync");
  const { purgeScope, inPurgeScope } = await import("@/lib/mls/purge");
  const sitemapModule = await import("@/app/homes/sitemap");
  // Next's own serializer for sitemap routes, so the sizes are the real XML's.
  const { resolveSitemap } =
    await import("next/dist/build/webpack/loaders/metadata/resolve-route-data.js");
  type NormalizedListing = import("@/lib/mls/types").NormalizedListing;
  type MapResult = import("@/lib/mls/types").MapResult;
  type ListingProvider = import("@/lib/mls/types").ListingProvider;

  const [source] = await db.select().from(dataSources).where(eq(dataSources.slug, "georgia-mls"));
  if (!source) throw new Error("adams_perf has no georgia-mls source: run npm run perf:seed");

  /** Feed records rebuilt from stored rows, so an untouched record matches exactly. */
  async function asFeedRecords(rows: (typeof listings.$inferSelect)[]) {
    const media = await db
      .select()
      .from(listingMedia)
      .where(
        inArray(
          listingMedia.listingId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(listingMedia.listingId), asc(listingMedia.sortOrder));
    const byId = new Map<string, typeof media>();
    for (const m of media) byId.set(m.listingId, [...(byId.get(m.listingId) ?? []), m]);
    // Everything a feed record carries; the rest (ids, slug, flags we derive) is ours.
    const ours = new Set([
      "id",
      "sourceId",
      "slug",
      "createdAt",
      "updatedAt",
      "removedAt",
      "isFeatured",
      "isCompanyListing",
      "listAgentId",
      "primaryPhotoUrl",
      "photoCount",
      "searchVector",
      "locationVector",
    ]);
    return rows.map((r) => {
      const id = r.id;
      const rest = Object.fromEntries(Object.entries(r).filter(([k]) => !ours.has(k)));
      return {
        ...rest,
        listAgentMlsId: null,
        media: (byId.get(id) ?? []).map((m) => ({
          sourceKey: m.sourceKey,
          url: m.url,
          kind: m.kind,
          caption: m.caption,
          width: m.width,
          height: m.height,
          sortOrder: m.sortOrder,
        })),
        openHouses: [],
      } as unknown as NormalizedListing;
    });
  }

  /**
   * A feed serving `records` in (timestamp, key) order in pages of 200,
   * honoring `from` like the RESO provider's keyset filter.
   */
  function feedOf(records: NormalizedListing[], pageDelayMs = 0): ListingProvider {
    const t = (r: NormalizedListing) => r.sourceModifiedAt!.getTime();
    const sorted = [...records].sort(
      (a, b) => t(a) - t(b) || a.listingKey.localeCompare(b.listingKey),
    );
    return {
      async *fetchUpdates(from) {
        const due = sorted.filter((r) => {
          if (!from) return true;
          const m = from.modifiedAt.getTime();
          return from.key === null
            ? t(r) >= m
            : t(r) > m || (t(r) === m && r.listingKey > from.key);
        });
        for (let i = 0; i < due.length; i += 200) {
          if (pageDelayMs) await new Promise((r) => setTimeout(r, pageDelayMs));
          const page = due.slice(i, i + 200);
          const last = page[page.length - 1];
          yield {
            items: page.map((listing): MapResult => ({ ok: true, listing })),
            last: { modifiedAt: last.sourceModifiedAt!, key: last.listingKey },
          };
        }
      },
      fetchActiveKeys() {
        throw new Error("not a purge");
      },
    };
  }

  const liveRows = (n: number) =>
    db
      .select()
      .from(listings)
      .where(and(eq(listings.sourceId, source.id), isNull(listings.removedAt)))
      .orderBy(sql`random()`)
      .limit(n);

  // --- incremental: 300 changed records ------------------------------------
  console.info("\nincremental (300 changed records)");
  const changed = await asFeedRecords(await liveRows(300));
  const stamp = Date.now();
  changed.forEach((r, i) => {
    r.listPrice -= 1000;
    r.sourceModifiedAt = new Date(stamp + i);
  });
  statements = 0;
  let t = performance.now();
  // "full" ignores the saved cursor, which earlier bench runs moved around.
  const inc = await syncSource(source.id, { mode: "full", provider: feedOf(changed) });
  let ms = performance.now() - t;
  console.info(
    `  ${Math.round(ms)} ms, ${statements} statements (${(statements / 300).toFixed(2)} per listing), result`,
    { upserted: inc.upserted, unchanged: inc.unchanged, mediaRowsWritten: inc.mediaRowsWritten },
  );
  expectThat("all 300 written", inc.upserted === 300 && inc.status === "succeeded");
  expectThat("under 5 s of database time", ms < 5000, `${Math.round(ms)} ms`);
  expectThat("at most 1 statement per listing", statements / 300 <= 1, `${statements}`);
  expectThat("unchanged photos are not rewritten", inc.mediaRowsWritten === 0);

  // --- unchanged: the same records again --------------------------------------
  console.info("\nunchanged (the same 300 records again)");
  statements = 0;
  t = performance.now();
  // Incremental: the run above caught up, so this one re-reads the lookback
  // window before its cursor, which holds all 300.
  const same = await syncSource(source.id, { provider: feedOf(changed) });
  ms = performance.now() - t;
  console.info(`  ${Math.round(ms)} ms, ${statements} statements`);
  expectThat(
    "nothing written for unchanged records",
    same.upserted === 0 && same.unchanged === 300 && same.mediaRowsWritten === 0,
    JSON.stringify({ upserted: same.upserted, unchanged: same.unchanged }),
  );

  // --- deadline: stop between pages, resume ----------------------------------
  console.info("\ndeadline (10,000 records, 50 pages of 200, 150 ms of feed latency per page)");
  const many = await asFeedRecords(await liveRows(10_000));
  const base = Date.now() + 60_000;
  many.forEach((r, i) => {
    r.listPrice += 1;
    r.sourceModifiedAt = new Date(base + i * 10);
  });
  const slow = feedOf(many, 150);
  const deadline = Date.now() + 3_000;
  const first = await syncSource(source.id, { mode: "full", provider: slow, deadline });
  const endedAt = Date.now();
  const [firstRun] = await db.select().from(syncRuns).where(eq(syncRuns.id, first.runId!)).limit(1);
  const finishedAt = firstRun.finishedAt!.getTime();
  console.info(
    `  first run: ${first.status}, ${first.upserted} written, finished ${deadline - finishedAt} ms ` +
      `before the deadline (then ${endedAt - finishedAt} ms rebuilding autocomplete places)`,
  );
  expectThat(
    "first run ends partial, before the deadline",
    first.status === "partial" && finishedAt <= deadline && first.upserted < 10_000,
  );
  expectThat(
    "the partial run is recorded with its cursor",
    firstRun.status === "partial" && firstRun.cursor?.getTime() === first.cursor?.getTime(),
  );
  const second = await syncSource(source.id, { provider: slow });
  console.info(
    `  second run: ${second.status}, ${second.upserted} written, ${second.unchanged} unchanged`,
  );
  const landed = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(
      and(
        eq(listings.sourceId, source.id),
        inArray(
          listings.listingKey,
          many.map((r) => r.listingKey),
        ),
        sql`${listings.sourceModifiedAt} >= ${new Date(base)}`,
      ),
    );
  expectThat(
    "the next run resumes and finishes: all 10,000 updated",
    second.status === "succeeded" && landed[0].n === 10_000,
    `${landed[0].n}`,
  );
  expectThat(
    "resumed rather than restarted",
    first.upserted + second.upserted === 10_000,
    `${first.upserted} + ${second.upserted}`,
  );

  // --- purge with 100,000 keys ------------------------------------------------
  const scope = purgeScope(new Date());
  const inScopeKeys = (
    await db
      .select({ key: listings.listingKey })
      .from(listings)
      .where(inPurgeScope(source.id, scope))
  ).map((r) => r.key);
  const keyFeed = (keys: string[]): ListingProvider => ({
    fetchUpdates() {
      throw new Error("a purge must not fetch updates");
    },
    async *fetchActiveKeys() {
      for (let i = 0; i < keys.length; i += 1000) yield keys.slice(i, i + 1000);
    },
  });
  const restore = async (keys: string[]) => {
    for (let i = 0; i < keys.length; i += 10_000) {
      await db
        .update(listings)
        .set({ removedAt: null })
        .where(
          and(
            eq(listings.sourceId, source.id),
            inArray(listings.listingKey, keys.slice(i, i + 10_000)),
          ),
        );
    }
  };

  console.info(`\npurge (${inScopeKeys.length} listings in scope)`);
  const gone = inScopeKeys.slice(0, Math.floor(inScopeKeys.length * 0.01));
  const feedKeys = inScopeKeys.slice(gone.length);
  for (let i = 0; feedKeys.length < 100_000; i++) feedKeys.push(`NOT-OURS-${i}`);
  statements = 0;
  t = performance.now();
  const purged = await syncSource(source.id, { mode: "purge", provider: keyFeed(feedKeys) });
  ms = performance.now() - t;
  console.info(`  ${feedKeys.length} keys: removed ${purged.removed} in ${Math.round(ms)} ms`);
  expectThat(
    "a 100,000-key purge removes exactly the listings that left",
    purged.status === "succeeded" && purged.removed === gone.length,
    `${purged.removed} of ${gone.length}`,
  );
  await restore(gone);

  console.info("\npurge cap (10% gone)");
  const tenPercent = inScopeKeys.slice(Math.floor(inScopeKeys.length * 0.1));
  let capError = "";
  try {
    await syncSource(source.id, { mode: "purge", provider: keyFeed(tenPercent) });
  } catch (e) {
    capError = e instanceof Error ? e.message : String(e);
  }
  const [capRun] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.sourceId, source.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  const stillLive = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(inPurgeScope(source.id, scope));
  console.info(`  ${capError}`);
  expectThat(
    "aborts, removes nothing, records a failed run",
    capError.startsWith("Purge cap:") &&
      capRun.status === "failed" &&
      stillLive[0].n === inScopeKeys.length,
  );

  // --- sitemap chunks -----------------------------------------------------------
  console.info("\nsitemap chunks");
  const [{ live }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(listings)
    .where(
      and(
        isNull(listings.removedAt),
        inArray(listings.status, ["active", "coming_soon", "active_under_contract", "pending"]),
      ),
    );
  const seen = new Set<string>();
  let total = 0;
  let worstBytes = 0;
  let worstMs = 0;
  for (const { id } of await sitemapModule.generateSitemaps()) {
    t = performance.now();
    const entries = await sitemapModule.default({ id: Promise.resolve(String(id)) });
    const chunkMs = performance.now() - t;
    const bytes = Buffer.byteLength(resolveSitemap(entries));
    worstBytes = Math.max(worstBytes, bytes);
    worstMs = Math.max(worstMs, chunkMs);
    total += entries.length;
    for (const e of entries) seen.add(e.url);
    console.info(
      `  chunk ${id}: ${entries.length} URLs, ${(bytes / 1048576).toFixed(2)} MB, ${Math.round(chunkMs)} ms`,
    );
    expectThat(
      `chunk ${id} within 10,000 URLs and 4 MB`,
      entries.length <= 10_000 && bytes < 4 * 1048576,
    );
  }
  expectThat(
    "the chunks list every live listing once",
    total === live && seen.size === live,
    `${total} URLs, ${seen.size} distinct, ${live} live`,
  );
  console.info(
    `  slowest chunk ${Math.round(worstMs)} ms, largest ${(worstBytes / 1048576).toFixed(2)} MB`,
  );

  // The scenarios rewrote thousands of rows; leave adams_perf ready for perf:measure
  // (index-only scans need an up-to-date visibility map).
  await db.execute(sql`vacuum analyze listings, listing_media, listing_events`);
  await db.$client.end();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
    if (check) process.exit(1);
  } else {
    console.info("\nAll checks passed.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
