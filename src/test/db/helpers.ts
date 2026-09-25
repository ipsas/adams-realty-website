import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dataSources, type DataSourceConfig } from "@/db/schema";
import { upsertListing, type PersistSource } from "@/lib/listings/persist";
import type { NormalizedListing } from "@/lib/mls/types";

/**
 * Shared by the `*.db.test.ts` files, which run against the throwaway test
 * database (vitest.config.mts). Each test starts from empty tables.
 */

export async function resetDb() {
  await db.execute(
    sql`truncate table listings, data_sources, agents, sync_runs restart identity cascade`,
  );
  await db.execute(sql`refresh materialized view places`);
}

/** Closes the pool, so the worker exits promptly. */
export async function closeDb() {
  await (globalThis as unknown as { pgPool?: { end(): Promise<void> } }).pgPool?.end();
}

export async function createSource(
  over: Partial<typeof dataSources.$inferInsert> = {},
): Promise<typeof dataSources.$inferSelect> {
  const [row] = await db
    .insert(dataSources)
    .values({
      slug: "gamls",
      name: "Georgia MLS",
      kind: "reso_web_api",
      config: { baseUrl: "https://feed.example.com/odata" } satisfies DataSourceConfig,
      ...over,
    })
    .returning();
  return row;
}

export const persistSource = (s: typeof dataSources.$inferSelect): PersistSource => ({
  id: s.id,
  slug: s.slug,
  kind: s.kind,
  config: s.config,
});

/** A plausible normalized listing; `i` makes the key, address and price unique. */
export function listing(i: number, over: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    listingKey: `K${String(i).padStart(6, "0")}`,
    mlsNumber: String(10_000_000 + i),
    status: "active",
    transactionType: "sale",
    propertyType: "single_family",
    listPrice: 300_000 + i,
    addressLine1: `${100 + i} Main St`,
    city: "Athens",
    state: "GA",
    postalCode: "30601",
    county: "Clarke",
    listDate: "2026-09-01",
    listAgentMlsId: null,
    sourceModifiedAt: new Date(Date.UTC(2026, 8, 25, 9, 0, 0) + i * 1000),
    media: [],
    openHouses: [],
    ...over,
  };
}

/** Writes listings the way the seed and dashboard do (not the sync). */
export async function insertListings(
  source: typeof dataSources.$inferSelect,
  items: NormalizedListing[],
) {
  const ids: string[] = [];
  for (const n of items) {
    const { id } = await db.transaction((tx) => upsertListing(tx, persistSource(source), n));
    ids.push(id);
  }
  return ids;
}
