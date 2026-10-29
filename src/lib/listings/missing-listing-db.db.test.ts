import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { closeDb, createSource, listing, persistSource, resetDb } from "@/test/db/helpers";
import { missingListingGuide } from "./missing-listing-db";
import { upsertListings } from "./persist";

// The proxy's lookup on a real table: null exactly when the listing page will
// show the listing, else the town's guide (from the row, or from the slug).

const ROYSTON = { city: "Royston", county: "Franklin", postalCode: "30662" };
const slugs: Record<string, string> = {};

beforeAll(async () => {
  await resetDb();
  const feed = await createSource();
  const rows = await upsertListings(db, persistSource(feed), [
    listing(1, ROYSTON),
    listing(2, { ...ROYSTON, status: "withdrawn" }),
    listing(3, ROYSTON),
  ]);
  await db.update(listings).set({ removedAt: new Date() }).where(eq(listings.id, rows[2].id));
  for (const [name, r] of [
    ["shown", rows[0]],
    ["hidden", rows[1]],
    ["removed", rows[2]],
  ] as const) {
    const [row] = await db
      .select({ slug: listings.slug })
      .from(listings)
      .where(eq(listings.id, r.id));
    slugs[name] = row.slug;
  }
});

afterAll(closeDb);

describe("missingListingGuide", () => {
  it("is null for a listing its page shows", async () => {
    expect(await missingListingGuide(db, slugs.shown)).toBeNull();
  });

  it("is the town's guide for a hidden-status or removed feed listing", async () => {
    expect(await missingListingGuide(db, slugs.hidden)).toBe("royston");
    expect(await missingListingGuide(db, slugs.removed)).toBe("royston");
  });

  it("reads the town from an unknown slug, and finds none outside the guides", async () => {
    expect(await missingListingGuide(db, "9-gone-rd-royston-ga-30662-zzzzzzz")).toBe("royston");
    expect(await missingListingGuide(db, "9-gone-rd-athens-ga-30601-zzzzzzz")).toBeUndefined();
  });
});
