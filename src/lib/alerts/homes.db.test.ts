import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { savedListings, users } from "@/db/schema";
import type { Email } from "@/lib/email";
import { upsertListings } from "@/lib/listings/persist";
import type { NormalizedListing } from "@/lib/mls/types";
import { closeDb, createSource, listing, persistSource, resetDb } from "@/test/db/helpers";
import { findHomeCandidates, loadHomeChanges } from "./homes";
import { runAlerts } from "./run";

// Saved-home alert emails under the Georgia MLS IDX rules: a saved feed home
// that turns Withdrawn or Expired is hidden from the public, so it must not
// reach an email either. Sold feed homes and the firm's own listings in any
// status stay public and still alert.

const HOUR = 3_600_000;
const now = new Date();
const listedAt = new Date(now.getTime() - 48 * HOUR);
const savedAt = new Date(now.getTime() - 47 * HOUR);
// Inside the event window: after the save, and settled (EVENT_SETTLE_MS) before `now`.
const changedAt = new Date(now.getTime() - 2 * HOUR);
const day = (d: Date) => d.toISOString().slice(0, 10);

const USER = "home-alerts-user";

/** The saved homes: where they start and how each one changes. */
const HOMES = {
  feedWithdrawn: { key: 1, from: "feed", to: { status: "withdrawn" } },
  feedExpired: { key: 2, from: "feed", to: { status: "expired" } },
  feedPriceCut: { key: 3, from: "feed", to: { listPrice: 250_000 } },
  feedSold: { key: 4, from: "feed", to: { status: "closed", closeDate: day(changedAt) } },
  firmWithdrawn: { key: 5, from: "manual", to: { status: "withdrawn" } },
} as const satisfies Record<
  string,
  { key: number; from: "feed" | "manual"; to: Partial<NormalizedListing> }
>;
type Name = keyof typeof HOMES;

const ids = new Map<string, Name>();
const named = (list: string[]) => list.map((id) => ids.get(id)).sort();
const address = (name: Name) => `${100 + HOMES[name].key} Main St`;

beforeAll(async () => {
  await resetDb();
  await db.execute(sql`truncate table users cascade`);
  await db
    .insert(users)
    .values({ id: USER, name: "Sam Saver", email: "sam@example.com", homeAlerts: true });
  const sources = {
    feed: persistSource(await createSource()),
    manual: persistSource(
      await createSource({ slug: "adams", name: "Adams Realty", kind: "manual", config: {} }),
    ),
  };

  for (const [name, h] of Object.entries(HOMES) as [Name, (typeof HOMES)[Name]][]) {
    const base = listing(h.key, {
      city: "Alertville",
      listDate: day(listedAt),
      sourceModifiedAt: listedAt,
    });
    const [row] = await upsertListings(db, sources[h.from], [base], { now: listedAt });
    ids.set(row.id, name);
    await db.insert(savedListings).values({ userId: USER, listingId: row.id, createdAt: savedAt });
    const changed = {
      ...base,
      ...h.to,
      sourceModifiedAt: changedAt,
      statusChangedAt: "status" in h.to ? changedAt : undefined,
    };
    await upsertListings(db, sources[h.from], [changed], { now: changedAt });
  }
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, USER));
  await closeDb();
});

const SHOWN: Name[] = ["feedPriceCut", "feedSold", "firmWithdrawn"];
const HIDDEN: Name[] = ["feedExpired", "feedWithdrawn"];

describe("saved-home alerts", () => {
  it("find only saved homes the public may still see", async () => {
    const candidates = await findHomeCandidates(db, now);
    expect(named(candidates.map((c) => c.listingId))).toEqual([...SHOWN].sort());
  });

  it("load no hidden home, even one claimed before it was hidden", async () => {
    const claimed = [...ids.keys()].map((listingId) => ({
      listingId,
      createdAt: savedAt,
      previous: null,
    }));
    const changes = await loadHomeChanges(db, claimed, now);
    expect(named(changes.map((c) => c.listing.id))).toEqual([...SHOWN].sort());
    // Each one shown has its change in the window.
    for (const c of changes) expect(c.events.length, ids.get(c.listing.id)).toBeGreaterThan(0);
  });

  it("email the user about the visible changes and never the hidden homes", async () => {
    const sent: Email[] = [];
    const result = await runAlerts({ db, now, send: async (e) => void sent.push(e) });
    const digests = sent.filter((e) => e.to === "sam@example.com");
    expect(digests).toHaveLength(1);
    expect(result.homes.emailed).toBe(1);
    const { text, html } = digests[0];
    for (const name of SHOWN) expect(text, name).toContain(address(name));
    for (const name of HIDDEN) {
      expect(text, name).not.toContain(address(name));
      expect(html, name).not.toContain(address(name));
    }
  });
});
