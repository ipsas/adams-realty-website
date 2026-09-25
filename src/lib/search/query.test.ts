import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseSearchParams } from "./params";
import { buildOrderBy, buildWhere, normalizeLocationQuery } from "./query";

const dialect = new PgDialect();
const now = new Date("2026-09-25T12:00:00Z");

function render(params: Record<string, string>) {
  const where = buildWhere(parseSearchParams(params), now);
  if (!where) throw new Error("expected a where clause");
  return dialect.sqlToQuery(where);
}

describe("buildWhere", () => {
  it("always hides removed listings and defaults to active/coming-soon sales", () => {
    const { sql, params } = render({});
    expect(sql).toContain(`"listings"."removed_at" is null`);
    expect(sql).toContain(`"listings"."transaction_type" = $1`);
    expect(params).toEqual(["sale", "active", "coming_soon"]);
  });

  it("adds under-contract and pending when requested", () => {
    expect(render({ pending: "1" }).params).toEqual([
      "sale",
      "active",
      "coming_soon",
      "active_under_contract",
      "pending",
    ]);
  });

  it("limits sold searches to a lookback window", () => {
    const { sql, params } = render({ mode: "sold", soldWithinDays: "90" });
    expect(sql).toContain(`"listings"."close_date" >=`);
    expect(params).toEqual(["closed", "sale", "2026-06-27"]);
  });

  it("matches ZIP codes exactly and other text with full-text search", () => {
    expect(render({ q: "78704" }).sql).toContain(`"listings"."postal_code" = $`);
    const text = render({ q: "Virginia-Highland, GA" });
    expect(text.sql).toContain("websearch_to_tsquery('english',");
    expect(text.params).toContain("Virginia-Highland");
  });

  it("uses the GiST-indexed point-in-box expression for map bounds", () => {
    const { sql, params } = render({ bounds: "-97.8,30.2,-97.7,30.3" });
    expect(sql).toContain(`point("listings"."longitude", "listings"."latitude") <@ box(point(`);
    expect(params.slice(-4)).toEqual([-97.8, 30.2, -97.7, 30.3]);
  });

  it("translates feature flags and ranges", () => {
    const { sql } = render({
      beds: "3",
      baths: "2",
      minSqft: "1500",
      pool: "1",
      openHouse: "1",
      maxHoa: "200",
    });
    expect(sql).toContain(`"listings"."bedrooms" >=`);
    expect(sql).toContain(`"listings"."bathrooms" >=`);
    expect(sql).toContain(`"listings"."living_area_sqft" >=`);
    expect(sql).toContain(`"listings"."has_pool" =`);
    expect(sql).toContain(`exists (select 1 from "open_houses"`);
    expect(sql).toContain(`"listings"."hoa_fee" is null`);
  });
});

describe("buildOrderBy", () => {
  it("sorts sold results by close date for 'newest'", () => {
    const order = buildOrderBy(parseSearchParams({ mode: "sold", sort: "newest" }));
    expect(dialect.sqlToQuery(order[0]).sql).toContain("close_date");
  });
});

describe("normalizeLocationQuery", () => {
  it("strips the state", () => {
    expect(normalizeLocationQuery("Decatur, GA")).toBe("Decatur");
    expect(normalizeLocationQuery("Johns Creek, Georgia 30097")).toBe("Johns Creek 30097");
    expect(normalizeLocationQuery("Gainesville")).toBe("Gainesville");
  });
});
