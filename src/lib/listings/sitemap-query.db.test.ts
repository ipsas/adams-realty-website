import { asc, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { countSitemapListings, getListingSitemapChunk } from "./sitemap-query";

// Listing sitemap chunks against Postgres: exactly the live indexable listings
// (the firm's own or in its area), each once, in a stable order, whatever the
// chunk size.

// Coming Soon is left out: the public never sees it, even the firm's own.
const LIVE = ["active", "active_under_contract", "pending"] as const;
let liveSlugs: string[];

/** Planner settings for this file's connections (the pool connects after this runs). */
async function setPlanner(sql: string) {
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  try {
    const [{ name }] = (await admin.query("select current_database() as name")).rows;
    for (const setting of sql.split(";").filter(Boolean)) {
      await admin.query(`alter database "${name}" ${setting}`);
    }
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  // Without index scans the planner returns rows in heap order, which isn't
  // id order here: only the query's ORDER BY can keep the chunks in order.
  await setPlanner(
    "set enable_indexscan = off;set enable_indexonlyscan = off;set enable_bitmapscan = off",
  );
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  // 13 live listings of every live status, inserted in an order unrelated to their ids…
  const live = Array.from({ length: 13 }, (_, i) => listing(i, { status: LIVE[i % 3] }));
  // …and some that must never appear: sold, off market, coming soon, and taken down.
  const hidden = [
    listing(100, { status: "closed", closeDate: "2026-08-01", closePrice: 300_000 }),
    listing(101, { status: "withdrawn" }),
    listing(102, { status: "expired" }),
    listing(103, { status: "active" }),
    listing(104, { status: "pending" }),
    listing(105, { status: "coming_soon" }),
  ];
  await insertListings(source, [...hidden.slice(0, 2), ...live, ...hidden.slice(2)]);
  // Someone else's listings from the feed: in the firm's area it's offered, outside it isn't.
  const feed = await createSource();
  const inArea = listing(200, { city: "Royston", county: "Franklin" });
  await insertListings(feed, [inArea, listing(201, { city: "Savannah", county: "Chatham" })]);
  live.push(inArea);
  await db
    .update(listings)
    .set({ removedAt: new Date() })
    .where(eq(listings.listingKey, listing(103).listingKey));
  await db
    .update(listings)
    .set({ removedAt: new Date() })
    .where(eq(listings.listingKey, listing(104).listingKey));
  liveSlugs = (
    await db
      .select({ slug: listings.slug, key: listings.listingKey })
      .from(listings)
      .orderBy(asc(listings.id))
  )
    .filter((r) => live.some((l) => l.listingKey === r.key))
    .map((r) => r.slug);
});
afterAll(async () => {
  await closeDb();
  await setPlanner("reset all");
});

const slugs = async (chunk: number, size?: number) =>
  (await getListingSitemapChunk(chunk, size)).map((r) => r.slug);

describe("getListingSitemapChunk", () => {
  it("holds every live indexable listing and nothing else, in id order", async () => {
    expect(liveSlugs).toHaveLength(14);
    expect(await slugs(0)).toEqual(liveSlugs);
    // With fewer live listings than one chunk holds, the next chunk is empty.
    expect(await slugs(1)).toEqual([]);
  });

  it("splits into consecutive chunks that together hold each live listing once", async () => {
    const chunks = await Promise.all([0, 1, 2, 3, 4].map((c) => slugs(c, 4)));
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 4, 2, 0]);
    expect(chunks.flat()).toEqual(liveSlugs);
  });

  it("is counted by countSitemapListings over the same listings", async () => {
    expect(await countSitemapListings()).toBe(liveSlugs.length);
  });

  it("gives each listing its last update, for <lastmod>", async () => {
    const [first] = await getListingSitemapChunk(0);
    expect(first.updatedAt).toBeInstanceOf(Date);
  });
});
