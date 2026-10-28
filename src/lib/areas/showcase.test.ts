import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { isShowcaseJunk, showcaseListing } from "./showcase";

describe("isShowcaseJunk", () => {
  const home = { livingAreaSqft: 1800, listPrice: 350_000, addressLine1: "12 Main Street" };

  it("keeps ordinary homes, cheap land without living area and big homes", () => {
    expect(isShowcaseJunk(home)).toBe(false);
    expect(isShowcaseJunk({ ...home, livingAreaSqft: null, listPrice: 90_000 })).toBe(false);
    expect(isShowcaseJunk({ ...home, livingAreaSqft: 0, listPrice: 1_000_000 })).toBe(false);
    expect(isShowcaseJunk({ ...home, listPrice: 6_000_000 })).toBe(false);
    expect(isShowcaseJunk({ ...home, addressLine1: "105 Lake Drive" })).toBe(false);
    expect(isShowcaseJunk({ ...home, addressLine1: "0123 Old Road" })).toBe(false);
  });

  it("drops a pricey listing with no living area", () => {
    expect(isShowcaseJunk({ ...home, livingAreaSqft: null, listPrice: 1_000_001 })).toBe(true);
    expect(isShowcaseJunk({ ...home, livingAreaSqft: 0, listPrice: 6_000_000 })).toBe(true);
  });

  it("drops street number 0", () => {
    expect(isShowcaseJunk({ ...home, addressLine1: "0 Jesse Jewell Parkway" })).toBe(true);
    expect(isShowcaseJunk({ ...home, addressLine1: " 00 Highway 17" })).toBe(true);
    expect(isShowcaseJunk({ ...home, addressLine1: "0" })).toBe(true);
  });
});

describe("showcaseListing", () => {
  it("renders the same rules as SQL, with the thresholds as parameters", () => {
    const q = new PgDialect().sqlToQuery(showcaseListing());
    expect(q.sql).toContain(`coalesce("listings"."living_area_sqft", 0) = 0`);
    expect(q.sql).toContain(`"listings"."list_price" >`);
    expect(q.sql).toContain(`btrim("listings"."address_line1") ~`);
    expect(q.params).toEqual([1_000_000, "^0+(\\s|$)"]);
  });
});
