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

// Keyword search matches the description as shown, so it can't confirm a lockbox code.

const search = async (kw: string) =>
  (
    await db
      .select({ description: listings.description })
      .from(listings)
      .where(buildWhere(parseSearchParams({ kw })))
  ).map((r) => r.description);

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(source, [
    listing(1, { description: "Charming ranch. Gate code 4521. Dining combo, 2-car garage." }),
    listing(2, { description: "Farmhouse on 1998 acres road, workshop 4521 sq ft." }),
  ]);
});

afterAll(closeDb);

describe("keyword search", () => {
  it("never matches a masked code, but still matches the words around it", async () => {
    expect(await search("4521")).toEqual(["Farmhouse on 1998 acres road, workshop 4521 sq ft."]);
    expect(await search("gate code 4521")).toEqual([]);
    expect(await search("gate code")).toHaveLength(1);
    expect(await search("dining combo garage")).toHaveLength(1);
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
