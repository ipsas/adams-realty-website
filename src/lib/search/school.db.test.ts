import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { buildWhere } from "./query";
import { searchListings } from "./service";

// A school search against Postgres: `high=hart` is Georgia's homes zoned for Hart
// however the feed spells it, not another state's Hart.

const crit = (qs: string) => parseSearchParams(new URLSearchParams(qs));

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(source, [
    listing(1, { city: "Hartwell", county: "Hart", schools: { high: "HART" } }),
    listing(2, { city: "Bowersville", county: "Hart", schools: { high: " Hart " } }),
    listing(3, { city: "Royston", county: "Franklin", schools: { high: "Franklin County" } }),
    listing(4, { city: "Lavonia", county: "Franklin", schools: { high: "Other" } }),
    // Hall County, Nebraska, with a high school named Hart: not Georgia's.
    listing(5, {
      city: "Grand Island",
      state: "NE",
      county: "Hall",
      postalCode: "68801",
      schools: { high: "Hart" },
    }),
  ]);
});
afterAll(closeDb);

const cities = async (qs: string) =>
  (await searchListings(crit(qs))).items.map((l) => l.city).sort();

describe("the school filter", () => {
  it("`high=hart` lists Georgia's homes zoned for Hart, any spelling", async () => {
    expect(await cities("high=hart")).toEqual(["Bowersville", "Hartwell"]);
    expect(await cities("high=HART%20%20")).toEqual(["Bowersville", "Hartwell"]);
  });

  it("a placeholder is no filter", async () => {
    expect(crit("high=Other").high).toBeUndefined();
  });

  it("a deep link with counties narrows to both", async () => {
    const where = buildWhere(crit("counties=Hart,Franklin&high=Hart"));
    const rows = await db.select({ city: listings.city }).from(listings).where(where);
    expect(rows.map((r) => r.city).sort()).toEqual(["Bowersville", "Hartwell"]);
    const franklin = buildWhere(crit("counties=Franklin&high=hart"));
    expect(await db.select({ id: listings.id }).from(listings).where(franklin)).toEqual([]);
  });
});
