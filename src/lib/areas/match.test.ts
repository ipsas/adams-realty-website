import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { areas, findArea, normalizeAreaName } from "@/config/areas";
import { listings } from "@/db/schema";
import {
  areaCondition,
  areaKeyRows,
  areaMatchKeys,
  guideForLocation,
  normalizedMatch,
  normalizedSql,
  prefilterPatterns,
  serviceAreaKeys,
  textArray,
} from "./match";

const dialect = new PgDialect();
const area = (name: string) => {
  const a = findArea(name);
  if (!a) throw new Error(`no area ${name}`);
  return a;
};

describe("areaMatchKeys", () => {
  it("matches intown neighborhoods by name and aliases only — never all of Atlanta", () => {
    expect(areaMatchKeys(area("Old Fourth Ward"))).toEqual({
      neighborhoods: ["old fourth ward", "old 4th ward", "o4w"],
      cities: [],
    });
  });

  it("lets a city-level area fall back to its city", () => {
    expect(areaMatchKeys(area("Decatur"))).toEqual({
      neighborhoods: ["decatur"],
      cities: ["decatur"],
    });
    expect(areaMatchKeys(area("Peachtree City")).cities).toEqual(["peachtree city"]);
  });

  it("doesn't treat the lake's post-office city as the lake", () => {
    expect(areaMatchKeys(area("Lake Lanier")).cities).toEqual([]);
  });

  it("dedupes aliases that normalize to the same key", () => {
    const keys = areaMatchKeys({
      name: "Virginia-Highland",
      city: "Atlanta",
      aliases: ["Virginia Highland"],
    });
    expect(keys.neighborhoods).toEqual(["virginia highland"]);
  });
});

describe("areaCondition", () => {
  it("prefilters with LIKE, then compares normalized names, all as bound parameters", () => {
    const { sql, params } = dialect.sqlToQuery(areaCondition(area("Virginia-Highland")));
    expect(sql).toBe(
      `((lower("listings"."neighborhood") like any(array[$1]::text[]) and ` +
        `btrim(regexp_replace(lower("listings"."neighborhood"), '[^a-z0-9]+', ' ', 'g')) = any(array[$2, $3]::text[])))`,
    );
    expect(params).toEqual(["%virginia%", "virginia highland", "virginia highlands"]);
  });

  it("adds the city clause only for city-level areas", () => {
    const { sql, params } = dialect.sqlToQuery(areaCondition(area("Roswell")));
    expect(sql).toContain(`lower("listings"."city")`);
    expect(sql).toContain(" or ");
    expect(params).toEqual(["%roswell%", "roswell", "%roswell%", "roswell"]);
    expect(dialect.sqlToQuery(areaCondition(area("Midtown"))).sql).not.toContain("city");
  });

  it("never interpolates names into the SQL text", () => {
    const { sql } = dialect.sqlToQuery(
      areaCondition({
        name: "O'Brien Park",
        city: "Atlanta",
        aliases: ["'; drop table listings; --"],
      }),
    );
    expect(sql).not.toContain("drop");
    expect(sql).not.toContain("brien");
  });
});

describe("prefilterPatterns", () => {
  it("uses each key's first token, deduped", () => {
    expect(prefilterPatterns(["old fourth ward", "old 4th ward", "o4w"])).toEqual([
      "%old%",
      "%o4w%",
    ]);
    expect(prefilterPatterns([])).toEqual([]);
  });

  // The prefilter must never reject a row the exact match would accept.
  it("never rejects a raw value whose normalized form is a key", () => {
    const likeToRegExp = (p: string) => new RegExp(p.replaceAll("%", ".*"));
    const raws = [
      "Virginia-Highland",
      "VIRGINIA HIGHLAND",
      "  Old 4th   Ward ",
      "O4W",
      "Lake Lanier",
      "East Atlanta Village",
      "Peachtree-City",
      "Johns Creek.",
    ];
    for (const a of areas) {
      const { neighborhoods } = areaMatchKeys(a);
      const patterns = prefilterPatterns(neighborhoods).map(likeToRegExp);
      for (const raw of raws) {
        if (!neighborhoods.includes(normalizeAreaName(raw))) continue;
        expect(
          patterns.some((re) => re.test(raw.toLowerCase())),
          `${raw} → ${a.slug}`,
        ).toBe(true);
      }
    }
  });

  it("renders an always-false match for an empty key list", () => {
    expect(dialect.sqlToQuery(normalizedMatch(listings.neighborhood, [])).sql).toBe("false");
  });
});

describe("areaKeyRows", () => {
  it("emits one row per area, kind and key", () => {
    expect(areaKeyRows([area("Decatur"), area("Old Fourth Ward")])).toEqual([
      { slug: "decatur", kind: "neighborhood", key: "decatur" },
      { slug: "decatur", kind: "city", key: "decatur" },
      { slug: "old-fourth-ward", kind: "neighborhood", key: "old fourth ward" },
      { slug: "old-fourth-ward", kind: "neighborhood", key: "old 4th ward" },
      { slug: "old-fourth-ward", kind: "neighborhood", key: "o4w" },
    ]);
  });
});

describe("sql helpers", () => {
  it("renders an empty text[] literal", () => {
    expect(dialect.sqlToQuery(textArray([])).sql).toBe("array[]::text[]");
  });

  it("mirrors normalizeAreaName in SQL", () => {
    expect(dialect.sqlToQuery(normalizedSql(textArray(["x"]))).sql).toContain(
      "regexp_replace(lower(",
    );
  });
});

describe("serviceAreaKeys / guideForLocation", () => {
  it("covers names agents type in their profiles", () => {
    expect(serviceAreaKeys(area("Johns Creek"))).toEqual(["johns creek"]);
  });

  it("finds a listing's guide by neighborhood, then city", () => {
    expect(guideForLocation("Old 4th Ward", "Atlanta")?.slug).toBe("old-fourth-ward");
    expect(guideForLocation(null, "Decatur")?.slug).toBe("decatur");
    expect(guideForLocation("Oakhurst", "Decatur")?.slug).toBe("decatur");
    expect(guideForLocation(null, "Atlanta")).toBeUndefined();
    expect(guideForLocation(null, "Buford")).toBeUndefined();
  });
});
