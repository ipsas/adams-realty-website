import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_CRITERIA, parseSearchParams, SORTS } from "./params";
import {
  buildOrderBy,
  buildWhere,
  hasLocation,
  lakeGuide,
  normalizeLocationQuery,
  type LocationScope,
} from "./query";

const dialect = new PgDialect();
const now = new Date("2026-09-25T12:00:00Z");

function render(params: Record<string, string>, scope?: LocationScope) {
  const where = buildWhere(parseSearchParams(params), now, scope);
  if (!where) throw new Error("expected a where clause");
  return dialect.sqlToQuery(where);
}

describe("buildWhere", () => {
  it("always hides removed listings and defaults to active/coming-soon sales", () => {
    const { sql, params } = render({});
    expect(sql).toContain(`"listings"."removed_at" is null`);
    // Georgia MLS: feed listings in a hidden status (Coming Soon among them) never match.
    expect(sql).toContain(`not "listings"."idx_hidden"`);
    expect(sql).toContain(`"listings"."transaction_type" = $1`);
    // Commercial is left out of the default search (site review #5).
    expect(params).toEqual(["sale", "active", "coming_soon", "commercial"]);
    expect(sql).toContain(`"listings"."property_type" <> $4`);
  });

  it("adds under-contract and pending when requested", () => {
    expect(render({ pending: "1" }).params).toEqual([
      "sale",
      "active",
      "coming_soon",
      "active_under_contract",
      "pending",
      "commercial",
    ]);
  });

  it("limits sold searches to a lookback window", () => {
    const { sql, params } = render({ mode: "sold", soldWithinDays: "90" });
    expect(sql).toContain(`"listings"."close_date" >=`);
    expect(params).toEqual(["closed", "sale", "2026-06-27", "commercial"]);
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
    expect(sql).not.toContain(`"listings"."property_type" <>`);
    expect(params.slice(-3)).toEqual(["land", "farm_ranch", "commercial"]);
  });

  it.each(["buy", "rent", "sold"])(
    "%s: with no type picked, everything but commercial (land stays in)",
    (mode) => {
      const { sql, params } = render({ mode });
      expect(sql).toContain(`"listings"."property_type" <> $`);
      expect(sql).not.toContain(`"listings"."property_type" in (`);
      expect(params).toContain("commercial");
      expect(params).not.toContain("land");
    },
  );

  it("commercial alone finds commercial", () => {
    const { sql, params } = render({ types: "commercial" });
    expect(sql).toContain(`"listings"."property_type" in ($`);
    expect(sql).not.toContain("<>");
    expect(params.at(-1)).toBe("commercial");
  });
});

// Site review #5: "Hartwell" also matched every "Lake Hartwell" home in Lavonia and Toccoa.
describe("a town search", () => {
  it("matches the town's name on city only, nothing else", () => {
    const { sql, params } = render({ q: "hartwell, GA" }, { town: "Hartwell" });
    expect(sql).toContain(
      `btrim(regexp_replace(lower("listings"."city"), '[^a-z0-9]+', ' ', 'g')) = any(array[$`,
    );
    expect(sql).not.toContain("location_vector");
    expect(sql).not.toContain("neighborhood");
    expect(sql).not.toContain("water_body");
    expect(params).toContain("hartwell");
  });

  it("without a resolved town, the text is matched as a place (lakes, neighborhoods…)", () => {
    const { sql } = render({ q: "Hartwell" });
    expect(sql).toContain("location_vector");
  });

  it("a ZIP stays a ZIP whatever the scope says", () => {
    const { sql } = render({ q: "30643" }, { town: "Hartwell" });
    expect(sql).toContain(`"listings"."postal_code" = $`);
    expect(sql).not.toContain(`lower("listings"."city")`);
  });
});

describe("lakeGuide", () => {
  it("finds lake guides by name or alias, never a town guide", () => {
    expect(lakeGuide("Lake Hartwell")?.slug).toBe("lake-hartwell");
    expect(lakeGuide("Hartwell Lake, GA")?.slug).toBe("lake-hartwell");
    expect(lakeGuide("Lanier")?.slug).toBe("lake-lanier");
    expect(lakeGuide("Hartwell")).toBeUndefined();
    expect(lakeGuide("Royston")).toBeUndefined();
    expect(lakeGuide(undefined)).toBeUndefined();
  });
});

describe("buildOrderBy", () => {
  it("sorts sold results by close date for 'newest'", () => {
    const order = buildOrderBy(parseSearchParams({ mode: "sold", sort: "newest" }));
    expect(dialect.sqlToQuery(order[0]).sql).toContain("close_date");
  });

  // Site review #8: land buyers compare tracts by size and price per acre.
  it("sorts by acreage, most first, tracts without a lot size last", () => {
    const order = buildOrderBy(parseSearchParams({ sort: "lot_desc" })).map(
      (o) => dialect.sqlToQuery(o).sql,
    );
    expect(order).toEqual([`"listings"."lot_size_sqft" desc nulls last`, `"listings"."id" asc`]);
  });

  it("sorts by price per acre, cheapest first, tracts without a lot size last", () => {
    const order = buildOrderBy(parseSearchParams({ sort: "price_per_acre_asc" })).map(
      (o) => dialect.sqlToQuery(o).sql,
    );
    expect(order[0]).toBe(
      `("listings"."list_price"::float / nullif("listings"."lot_size_sqft", 0)) asc nulls last`,
    );
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

describe("hasLocation", () => {
  it("is true for a place and false for no q or the state alone", () => {
    expect(hasLocation({ q: "Savannah, GA" })).toBe(true);
    expect(hasLocation({ q: "30662" })).toBe(true);
    expect(hasLocation({ q: undefined })).toBe(false);
    expect(hasLocation({ q: "Georgia, USA" })).toBe(false);
  });
});

// Georgia MLS IDX agreement §12: once the consumer picks a sort other than the
// default ("recommended", which may put featured homes first), results are
// ranked organically. Nothing is paid for, and neither our own nor featured
// listings may be lifted.
describe("unbiased sort", () => {
  const PROMOTED = /is_featured|is_company_listing|list_agent_id|list_office/;

  it("recommended is the default, the only order that looks at featured homes", () => {
    expect(DEFAULT_CRITERIA.sort).toBe("recommended");
    expect(parseSearchParams({}).sort).toBe("recommended");
    const recommended = buildOrderBy(parseSearchParams({})).map((o) => dialect.sqlToQuery(o).sql);
    expect(recommended.join(", ")).toMatch(/is_featured/);
  });

  it.each(SORTS.filter((s) => s !== "recommended"))(
    "sort=%s ranks only by the chosen field, then id",
    (sort) => {
      for (const mode of ["buy", "rent", "sold"]) {
        const order = buildOrderBy(parseSearchParams({ sort, mode }))
          .map((o) => dialect.sqlToQuery(o).sql)
          .join(", ");
        expect(order, `${mode} ${sort}`).not.toMatch(PROMOTED);
        expect(order.endsWith(`"listings"."id" asc`), order).toBe(true);
      }
    },
  );
});
