import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { CODE_THEN_TEXT, NO_CODE, WITH_CODE } from "@/lib/listings/access-code-cases";
import {
  ACCESS_CODE_PG,
  ACCESS_CODE_PG_REPLACEMENT,
  redactAccessCodes,
} from "@/lib/listings/excluded-fields";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { buildWhere } from "./query";

// Keyword search matches the description and features as shown, so it can't confirm a
// lockbox code.

const RANCH = "Charming ranch. Gate code 4521. Dining combo, 2-car garage.";
const FARMHOUSE = "Farmhouse on 1998 acres road, workshop 4521 sq ft.";
const COTTAGE = "Cozy cottage. Living room/kitchen/dining combo, 2-car garage.";
const BUNGALOW = "Bright bungalow near the square.";
const DUPLEX = "Updated duplex, fenced yard.";

const search = async (kw: string) =>
  (
    await db
      .select({ description: listings.description })
      .from(listings)
      .where(buildWhere(parseSearchParams({ kw })))
  )
    .map((r) => r.description)
    .sort();

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(source, [
    listing(1, { description: RANCH }),
    listing(2, { description: FARMHOUSE }),
    listing(3, { description: COTTAGE }),
    listing(4, {
      description: BUNGALOW,
      features: {
        interior: ["Breakfast Bar", "Walk-In Closet"],
        associationAmenities: ["Clubhouse"],
        security: ["Gate code 4455"],
      },
    }),
    listing(5, { description: DUPLEX, features: { appliances: ["Washer/Dryer"] } }),
  ]);
});

afterAll(closeDb);

describe("keyword search", () => {
  it("never matches a masked code, but still matches the words around it", async () => {
    expect(await search("4521")).toEqual([FARMHOUSE]);
    expect(await search("gate code 4521")).toEqual([]);
    expect(await search("4455")).toEqual([]);
    expect(await search("gate code 4455")).toEqual([]);
    expect(await search("gate code")).toEqual([BUNGALOW, RANCH].sort());
  });

  it("reads 'room/kitchen/dining' as three words", async () => {
    expect(await search("dining combo")).toEqual([COTTAGE, RANCH].sort());
    expect(await search("kitchen dining combo")).toEqual([COTTAGE]);
    expect(await search("dining combo garage")).toEqual([COTTAGE, RANCH].sort());
    expect(await search("room/kitchen/dining")).toEqual([COTTAGE]);
  });

  it("matches the string values in features, never their keys", async () => {
    expect(await search("breakfast bar")).toEqual([BUNGALOW]);
    expect(await search("clubhouse")).toEqual([BUNGALOW]);
    expect(await search("walk-in closet")).toEqual([BUNGALOW]);
    expect(await search("interior")).toEqual([]);
    expect(await search("security")).toEqual([]);
  });

  it("reads 'Washer/Dryer' in features as two words", async () => {
    expect(await search("washer")).toEqual([DUPLEX]);
    expect(await search("washer/dryer")).toEqual([DUPLEX]);
  });

  it("masks in Postgres exactly as on the page", async () => {
    for (const text of [...NO_CODE, ...[...WITH_CODE, ...CODE_THEN_TEXT].map(([t]) => t)].map(
      (t) => `Lovely home. ${t}. Call today.`,
    )) {
      const { rows } = await db.execute<{ masked: string }>(
        sql`select regexp_replace(${text}, ${ACCESS_CODE_PG}, ${ACCESS_CODE_PG_REPLACEMENT}, 'gi') as masked`,
      );
      expect(rows[0].masked, text).toBe(redactAccessCodes(text));
    }
  });
});
