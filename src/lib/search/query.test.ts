import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ACCESS_CODE_PG } from "@/lib/listings/excluded-fields";
import { DEFAULT_CRITERIA, parseSearchParams, SORTS } from "./params";
import {
  buildOrderBy,
  buildConditions,
  buildWhere,
  countyCondition,
  countyKey,
  defaultBuyConditions,
  hasLocation,
  lakeGuide,
  listedWithin,
  MAX_PLAUSIBLE_LOT_SQFT,
  normalizeLocationQuery,
  soldWithin,
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

  it("counts the sold window from the New York calendar date", () => {
    // 10pm EDT on Oct 26 is Oct 27 in UTC: the window still starts at Oct 26 minus 365 days.
    const where = soldWithin(365, new Date("2026-10-27T02:00:00Z"));
    expect(dialect.sqlToQuery(where[2]!).params).toEqual(["2025-10-26"]);
  });

  it("counts the listed-within window from the New York calendar date", () => {
    // 10pm EDT on Oct 26 is Oct 27 in UTC: the window still starts at Oct 26 minus 7 days.
    const late = listedWithin(7, new Date("2026-10-27T02:00:00Z"));
    expect(dialect.sqlToQuery(late).params).toEqual(["2026-10-19"]);
    // 00:30 EDT on Oct 27: the New York date has turned over too.
    const after = listedWithin(7, new Date("2026-10-27T04:30:00Z"));
    expect(dialect.sqlToQuery(after).params).toEqual(["2026-10-20"]);
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

describe("acreage, HOA, keyword, price-reduced, 55+ and fireplace filters", () => {
  it("adds nothing by default, so listings with unknown values show", () => {
    const { sql } = render({});
    expect(sql).not.toContain("lot_size_sqft");
    expect(sql).not.toContain("association_yn");
    expect(sql).not.toContain("senior_community");
    expect(sql).not.toContain("search_vector");
    expect(sql).not.toContain("original_list_price");
    expect(sql).not.toContain("fireplaces_total");
  });

  it("bounds a known, plausible lot size in square feet", () => {
    const { sql, params } = render({ minAcres: "0.5", maxAcres: "2" });
    expect(sql).toContain(`"listings"."lot_size_sqft" > 0`);
    expect(sql).toContain(`"listings"."lot_size_sqft" >= $`);
    expect(sql).toContain(`"listings"."lot_size_sqft" <= $`);
    expect(params).toEqual(
      expect.arrayContaining([MAX_PLAUSIBLE_LOT_SQFT, 0.5 * 43_560, 2 * 43_560]),
    );
    expect(MAX_PLAUSIBLE_LOT_SQFT).toBe(20_000 * 43_560);
  });

  it("guards a lone acreage bound too, and rounds to whole square feet", () => {
    const { sql, params } = render({ maxAcres: "0.333" });
    expect(sql).toContain(`"listings"."lot_size_sqft" > 0`);
    expect(params).toEqual(expect.arrayContaining([MAX_PLAUSIBLE_LOT_SQFT, 14_505]));
    expect(sql.match(/"lot_size_sqft" <= \$/g)).toHaveLength(2);
  });

  it("adds no acreage condition for an empty or blank bound (never a 0-acre bound)", () => {
    const blanks: Record<string, string>[] = [
      { minAcres: "" },
      { maxAcres: " " },
      { minAcres: "", maxAcres: "  " },
    ];
    for (const params of blanks) {
      const { sql, params: values } = render(params);
      expect(sql).not.toContain("lot_size_sqft");
      expect(values).not.toContain(0);
    }
    const blankUrl = buildWhere(
      parseSearchParams(new URLSearchParams("minAcres=&maxAcres=%20")),
      now,
    );
    expect(dialect.sqlToQuery(blankUrl!).sql).not.toContain("lot_size_sqft");
    // One real bound and one blank: only the real one applies.
    const { sql, params } = render({ minAcres: "2", maxAcres: "" });
    expect(sql).toContain(`"listings"."lot_size_sqft" >= $`);
    expect(sql.match(/"lot_size_sqft" <= \$/g)).toHaveLength(1);
    expect(params).toContain(2 * 43_560);
  });

  it("keeps the legacy min lot size filter as it was", () => {
    const { sql, params } = render({ minLotSqft: "10890" });
    expect(sql).toContain(`"listings"."lot_size_sqft" >= $`);
    expect(sql).not.toContain(`"listings"."lot_size_sqft" > 0`);
    expect(params).toContain(10890);
  });

  it("matches HOA yes on AssociationYN or a fee", () => {
    const { sql } = render({ hoa: "yes" });
    expect(sql).toContain(`("listings"."association_yn" = true or "listings"."hoa_fee" > 0)`);
  });

  it("matches HOA no on AssociationYN false, or unknown with a $0 fee (not every unknown)", () => {
    const { sql } = render({ hoa: "no" });
    // A fee above $0 is an HOA even beside a false flag, as the listing page shows it (hoaStatus).
    expect(sql).toContain(
      `(("listings"."association_yn" = false and ("listings"."hoa_fee" is null or "listings"."hoa_fee" <= 0)) or ("listings"."association_yn" is null and "listings"."hoa_fee" = 0))`,
    );
  });

  it("matches keywords on the stored keyword_tsv, apart from the location box", () => {
    const { sql, params } = render({ kw: "barn workshop" });
    expect(sql).toContain(`("listings"."keyword_tsv" @@ websearch_to_tsquery('english', $`);
    expect(sql).not.toContain("location_vector");
    expect(params).toContain("barn workshop");
    const both = render({ q: "Atlanta", kw: "dock" });
    expect(both.sql).toContain("location_vector");
    expect(both.sql).toContain("keyword_tsv");
    expect(both.params).toEqual(expect.arrayContaining(["Atlanta", "dock"]));
  });

  it("falls back to search_vector and the masked description only while keyword_tsv is null", () => {
    const { sql, params } = render({ kw: "gate code" });
    // keyword_tsv is already masked: a filled row is never rechecked, and the cheap tests
    // come before the regex.
    expect(sql).toMatch(
      /\("listings"\."keyword_tsv" @@ websearch_to_tsquery\('english', \$\d+\) or \("listings"\."keyword_tsv" is null and "listings"\."search_vector" @@ websearch_to_tsquery\('english', \$\d+\) and to_tsvector\('english', concat_ws\(' ',/,
    );
    expect(sql).toMatch(/regexp_replace\("listings"\."description", \$\d+, \$\d+, 'gi'\)\)\)/);
    expect(sql).not.toContain("features");
    expect(params.filter((p) => p === ACCESS_CODE_PG)).toHaveLength(1);
  });

  it("reads '/' in keywords as a space, like the indexed text", () => {
    expect(render({ kw: "room/kitchen/dining" }).params).toContain("room kitchen dining");
  });

  it("matches price reduced against the original list price, except in sold or rent mode", () => {
    const { sql } = render({ priceReduced: "1" });
    expect(sql).toContain(`"listings"."original_list_price" is not null`);
    expect(sql).toContain(`"listings"."list_price" < "listings"."original_list_price"`);
    expect(render({ priceReduced: "1", mode: "sold" }).sql).not.toContain("original_list_price");
    expect(render({ priceReduced: "1", mode: "rent" }).sql).not.toContain("original_list_price");
  });

  it("filters 55+ communities: only, or exclude keeping unknowns", () => {
    expect(render({ age55: "only" }).sql).toContain(`"listings"."senior_community" = $`);
    expect(render({ age55: "exclude" }).sql).toContain(`"listings"."senior_community" is not true`);
  });

  it("matches a fireplace on fireplaces_total", () => {
    const { sql, params } = render({ fireplace: "1" });
    expect(sql).toContain(`"listings"."fireplaces_total" >= $`);
    expect(params).toContain(1);
  });
});

describe("main-level bedroom filters", () => {
  it("add nothing by default", () => {
    const { sql } = render({});
    expect(sql).not.toContain("primary_bedroom_on_main");
    expect(sql).not.toContain("main_level_bedrooms");
  });

  it("match a known primary bedroom on main, never an unknown", () => {
    const { sql, params } = render({ primaryOnMain: "1" });
    expect(sql).toContain(`"listings"."primary_bedroom_on_main" = $`);
    expect(params).toContain(true);
  });

  it("match at least one known bedroom on the main level", () => {
    const { sql, params } = render({ bedOnMain: "1" });
    expect(sql).toContain(`"listings"."main_level_bedrooms" >= $`);
    expect(params).toContain(1);
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

describe("a county search", () => {
  it("matches the county only, however a feed spells it", () => {
    const { sql, params } = render({ q: "Hall County" }, { county: "Hall County" });
    expect(sql).toContain(`lower("listings"."county") like $`);
    expect(sql).toContain(
      `regexp_replace(btrim(regexp_replace(lower("listings"."county"), '[^a-z0-9]+', ' ', 'g')), ' county$', '') = $`,
    );
    expect(sql).not.toContain("location_vector");
    expect(sql).not.toContain(`"listings"."city"`);
    expect(sql).not.toContain("address_line1");
    expect(params).toContain("hall%");
    expect(params).toContain("hall");
  });

  it("a town in the scope wins over a county", () => {
    const { sql } = render({ q: "Forsyth" }, { town: "Forsyth", county: "Forsyth County" });
    expect(sql).toContain(`lower("listings"."city")`);
    expect(sql).not.toContain(`"listings"."county"`);
  });

  it("matches DeKalb spelled joined or split, still LIKE-prefiltered", () => {
    for (const county of ["DeKalb County", "De Kalb", "DEKALB"]) {
      const { sql, params } = dialect.sqlToQuery(countyCondition(county));
      expect(sql).toContain(`lower("listings"."county") like any(array[$1, $2]::text[])`);
      expect(sql).toContain(`' county$', '') = any(array[$3, $4]::text[])`);
      expect(params).toEqual(["dekalb%", "de%", "dekalb", "de kalb", "GA"]);
    }
    expect(dialect.sqlToQuery(countyCondition("Mc'Duffie")).params).toEqual([
      "mcduffie%",
      "mc%",
      "mcduffie",
      "mc duffie",
      "GA",
    ]);
  });

  it("matches the market's state only (Clay County, AL is not Georgia's)", () => {
    for (const county of ["Clay County", "DeKalb"]) {
      const { sql, params } = dialect.sqlToQuery(countyCondition(county));
      expect(sql).toMatch(/^\(lower\("listings"\."county"\) like /);
      expect(sql).toContain(`"listings"."state" = $`);
      expect(params.at(-1)).toBe("GA");
    }
  });

  it("a ZIP stays a ZIP", () => {
    const { sql } = render({ q: "30501" }, { county: "Hall County" });
    expect(sql).toContain(`"listings"."postal_code" = $`);
    expect(sql).not.toContain(`"listings"."county"`);
  });
});

describe("countyKey", () => {
  it("reads '<Name> County', with any case, punctuation or state, and a bare name", () => {
    expect(countyKey("Hall County")).toBe("hall");
    expect(countyKey("hall county, ga")).toBe("hall");
    expect(countyKey("HALL COUNTY, Georgia")).toBe("hall");
    expect(countyKey("Hall")).toBe("hall");
    expect(countyKey("  gwinnett ")).toBe("gwinnett");
  });

  it("reads a half-typed County word or state (QA L21-1, L21-2)", () => {
    for (const q of [
      "Hall Co",
      "hall co",
      "Hall cou",
      "Hall Coun",
      "Hall Count",
      "Hall, County",
      "Hall County, G",
      "Hall County, Ga",
      "Hall County, Geo",
      "Hall, GA",
      "Hall, g",
      "Hall Co, Georgia",
      "Hall Co GA",
    ]) {
      expect(countyKey(q), q).toBe("hall");
    }
    // Not a County word or a state: kept, so no county matches and the text is searched.
    expect(countyKey("Coco")).toBe("coco");
    expect(countyKey("Hall Cove")).toBe("hall cove");
    expect(countyKey("Hall G")).toBe("hall g");
    expect(countyKey("Hall C")).toBe("hall c");
  });

  it("keys DeKalb, McDuffie and McIntosh however they are spelled", () => {
    for (const q of [
      "De Kalb",
      "de kalb county",
      "Dekalb",
      "DEKALB County",
      "De'Kalb",
      "DeKalb Co",
    ]) {
      expect(countyKey(q), q).toBe("dekalb");
    }
    for (const q of ["Mc Duffie", "McDuffie", "mc duffie county", "Mc'Duffie", "McDuffie, GA"]) {
      expect(countyKey(q), q).toBe("mcduffie");
    }
    for (const q of ["McIntosh", "Mc Intosh", "mcintosh county, ga"]) {
      expect(countyKey(q), q).toBe("mcintosh");
    }
    expect(countyKey("Ben Hill County")).toBe("ben hill");
  });

  it("is nothing for a ZIP, a lake guide, the state alone or no text", () => {
    expect(countyKey("30501")).toBeUndefined();
    expect(countyKey("Lake Lanier")).toBeUndefined();
    expect(countyKey("Georgia")).toBeUndefined();
    expect(countyKey(undefined)).toBeUndefined();
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

describe("defaultBuyConditions", () => {
  it("is the default buy search's conditions, as buildConditions makes them", () => {
    const where = (conds: ReturnType<typeof defaultBuyConditions>) =>
      dialect.sqlToQuery(and(...conds)!);
    expect(where(defaultBuyConditions())).toEqual(
      where(buildConditions(parseSearchParams({}), now)),
    );
    const { params } = where(defaultBuyConditions());
    expect(params).toEqual(["sale", "active", "coming_soon", "commercial"]);
  });
});
