import { getTableColumns, is, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { listings } from "@/db/schema";
import { cardColumns } from "./card";
import { COMPENSATION_FIELDS, omitCompensation, publicListingColumns } from "./public-fields";

// Georgia MLS R&R Art. V: no buyer-broker compensation on public pages or payloads.

const stored = {
  id: "l1",
  slug: "306-sycamore-place",
  listOfficeName: null,
  variableCompensation: false,
  buyerAgencyCompensation: "2.5 %",
  compensationComments: "Paid at closing from the seller's proceeds.",
};

/** Every column name a column map selects (plain columns and raw SQL). */
function selectedSql(columns: Record<string, unknown>): string {
  const dialect = new PgDialect();
  return Object.values(columns)
    .map((c) => (is(c, SQL) ? dialect.sqlToQuery(c).sql : (c as { name: string }).name))
    .join(" ");
}

describe("public listing fields", () => {
  it("omitCompensation strips the compensation keys and values from a listing", () => {
    const json = JSON.stringify(omitCompensation(stored));
    expect(json).not.toContain("2.5 %");
    expect(json).not.toContain("Paid at closing");
    expect(json).not.toMatch(/compensation/i);
    expect(JSON.parse(json)).toEqual({
      id: "l1",
      slug: "306-sycamore-place",
      listOfficeName: null,
    });
  });

  it("the property page selects every listing column but the compensation ones", () => {
    const all = Object.keys(getTableColumns(listings));
    for (const k of COMPENSATION_FIELDS) {
      expect(all).toContain(k);
      expect(publicListingColumns).not.toHaveProperty(k);
    }
    expect(Object.keys(publicListingColumns)).toEqual(
      all.filter((k) => !(COMPENSATION_FIELDS as readonly string[]).includes(k)),
    );
    expect(selectedSql(publicListingColumns)).not.toMatch(/compensation/i);
  });

  it("cards (search, map, saved homes, similar homes) select no compensation column", () => {
    expect(selectedSql(cardColumns)).not.toMatch(/compensation/i);
    expect(Object.keys(cardColumns).join(" ")).not.toMatch(/compensation/i);
  });
});
