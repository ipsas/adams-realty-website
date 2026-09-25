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

  it("matches ZIP codes exactly", () => {
    const { sql, params } = render({ q: "30662" });
    expect(sql).toContain(`"listings"."postal_code" = $`);
    expect(sql).not.toContain("location_vector");
    expect(params).toContain("30662");
  });

  it("matches a place against the location vector, never the description", () => {
    const { sql, params } = render({ q: "Atlanta" });
    expect(sql).toContain(`"listings"."location_vector" @@ websearch_to_tsquery('simple', $`);
    expect(sql).not.toContain("search_vector");
    expect(sql).not.toContain("description");
    expect(params).toContain("Atlanta");
    // No area guide is named Atlanta, so no guide branch.
    expect(sql).not.toContain("water_body");
  });

  // Real feeds put the subdivision in `neighborhood` and the lake only in
  // WaterBodyName, sometimes by an alias ("Lanier"): a lake that names a guide
  // also matches the guide's names on `water_body`, inside its counties.
  it("resolves a lake guide's name to the guide's names on neighborhood and water_body", () => {
    const { sql, params } = render({ q: "Lake Hartwell, GA" });
    expect(params).toContain("Lake Hartwell");
    expect(sql).toContain(`"listings"."location_vector" @@ websearch_to_tsquery('simple', $`);
    expect(sql).toContain(
      `btrim(regexp_replace(lower("listings"."water_body"), '[^a-z0-9]+', ' ', 'g')) = any(array[`,
    );
    expect(sql).toContain(`"listings"."county" is null or regexp_replace(`);
    expect(params).toEqual(expect.arrayContaining(["lake hartwell", "hartwell lake"]));
    expect(params).toEqual(expect.arrayContaining(["hart", "franklin", "stephens"]));
  });

  it("resolves an alias to its guide: 'Lanier' finds Lake Lanier's water_body keys", () => {
    const { sql, params } = render({ q: "Lanier" });
    expect(sql).toContain(`lower("listings"."water_body")`);
    expect(params).toEqual(
      expect.arrayContaining(["lake lanier", "lanier", "lake sidney lanier", "hall", "forsyth"]),
    );
  });

  it("uses plain ranges for map bounds (not a GiST box, which the planner misestimates)", () => {
    const { sql, params } = render({ bounds: "-97.8,30.2,-97.7,30.3" });
    expect(sql).toContain(`"listings"."longitude" between $`);
    expect(sql).toContain(`"listings"."latitude" between $`);
    expect(sql).not.toContain("point(");
    expect(params.slice(-4)).toEqual([-97.8, -97.7, 30.2, 30.3]);
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

describe("property types", () => {
  it("filters on any mix of types, commercial included", () => {
    const { sql, params } = render({ types: "land,farm_ranch,commercial" });
    expect(sql).toContain(`"listings"."property_type" in ($`);
    expect(params.slice(-3)).toEqual(["land", "farm_ranch", "commercial"]);
  });
});

describe("buildOrderBy", () => {
  it("sorts sold results by close date for 'newest'", () => {
    const order = buildOrderBy(parseSearchParams({ mode: "sold", sort: "newest" }));
    expect(dialect.sqlToQuery(order[0]).sql).toContain("close_date");
  });
});

describe("normalizeLocationQuery", () => {
  it("strips a trailing state, before an optional ZIP", () => {
    expect(normalizeLocationQuery("Royston, GA")).toBe("Royston");
    expect(normalizeLocationQuery("Royston, GA 30662")).toBe("Royston 30662");
    expect(normalizeLocationQuery("Flowery Branch, Georgia 30542")).toBe("Flowery Branch 30542");
    expect(normalizeLocationQuery("Savannah, GA, USA")).toBe("Savannah");
    expect(normalizeLocationQuery("Gainesville")).toBe("Gainesville");
  });

  it("treats the state alone as no location", () => {
    expect(normalizeLocationQuery("Georgia")).toBe("");
    expect(normalizeLocationQuery("GA")).toBe("");
    expect(normalizeLocationQuery(" georgia ")).toBe("");
    expect(normalizeLocationQuery("Georgia, USA")).toBe("");
    expect(render({ q: "Georgia" }).sql).not.toContain("location_vector");
  });

  it("keeps a state name that is part of a place name", () => {
    expect(normalizeLocationQuery("The Georgia Club")).toBe("The Georgia Club");
    expect(normalizeLocationQuery("Georgia Ave, Macon")).toBe("Georgia Ave Macon");
    expect(normalizeLocationQuery("Gaines Road")).toBe("Gaines Road");
  });
});
