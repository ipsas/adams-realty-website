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
  it("matches lakes by name and aliases only — never their whole post-office town", () => {
    expect(areaMatchKeys(area("Lake Hartwell"))).toEqual({
      neighborhoods: ["lake hartwell", "hartwell lake"],
      cities: [],
    });
    expect(areaMatchKeys(area("Lake Lanier")).cities).toEqual([]);
  });

  it("lets a town-level area fall back to its city", () => {
    expect(areaMatchKeys(area("Royston"))).toEqual({
      neighborhoods: ["royston"],
      cities: ["royston"],
    });
    expect(areaMatchKeys(area("Franklin Springs")).cities).toEqual(["franklin springs"]);
  });

  it("dedupes aliases that normalize to the same key", () => {
    const keys = areaMatchKeys({
      name: "Lake Hartwell",
      city: "Hartwell",
      aliases: ["Lake-Hartwell"],
    });
    expect(keys.neighborhoods).toEqual(["lake hartwell"]);
  });
});

describe("areaCondition", () => {
  it("prefilters with LIKE, then compares normalized names, all as bound parameters", () => {
    const { sql, params } = dialect.sqlToQuery(areaCondition(area("Lake Hartwell")));
    expect(sql).toBe(
      `((lower("listings"."neighborhood") like any(array[$1, $2]::text[]) and ` +
        `btrim(regexp_replace(lower("listings"."neighborhood"), '[^a-z0-9]+', ' ', 'g')) = any(array[$3, $4]::text[])))`,
    );
    expect(params).toEqual(["%lake%", "%hartwell%", "lake hartwell", "hartwell lake"]);
  });

  it("adds the city clause only for town-level areas", () => {
    const { sql, params } = dialect.sqlToQuery(areaCondition(area("Toccoa")));
    expect(sql).toContain(`lower("listings"."city")`);
    expect(sql).toContain(" or ");
    expect(params).toEqual(["%toccoa%", "toccoa", "%toccoa%", "toccoa"]);
    expect(dialect.sqlToQuery(areaCondition(area("Lake Lanier"))).sql).not.toContain("city");
  });

  it("never interpolates names into the SQL text", () => {
    const { sql } = dialect.sqlToQuery(
      areaCondition({
        name: "O'Brien Park",
        city: "Royston",
        aliases: ["'; drop table listings; --"],
      }),
    );
    expect(sql).not.toContain("drop");
    expect(sql).not.toContain("brien");
  });
});

describe("prefilterPatterns", () => {
  it("uses each key's first token, deduped", () => {
    expect(prefilterPatterns(["lake sidney lanier", "lanier", "lake lanier"])).toEqual([
      "%lake%",
      "%lanier%",
    ]);
    expect(prefilterPatterns([])).toEqual([]);
  });

  // The prefilter must never reject a row the exact match would accept.
  it("never rejects a raw value whose normalized form is a key", () => {
    const likeToRegExp = (p: string) => new RegExp(p.replaceAll("%", ".*"));
    const raws = [
      "Lake-Hartwell",
      "LAKE HARTWELL",
      "  Hartwell   Lake ",
      "LANIER",
      "Lake Sidney Lanier",
      "Flowery-Branch",
      "FRANKLIN SPRINGS",
      "Braselton.",
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
    expect(areaKeyRows([area("Royston"), area("Lake Hartwell")])).toEqual([
      { slug: "royston", kind: "neighborhood", key: "royston" },
      { slug: "royston", kind: "city", key: "royston" },
      { slug: "lake-hartwell", kind: "neighborhood", key: "lake hartwell" },
      { slug: "lake-hartwell", kind: "neighborhood", key: "hartwell lake" },
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
  it("covers names agents type in their profiles: the town, or its county", () => {
    expect(serviceAreaKeys(area("Comer"))).toEqual(["comer", "madison county"]);
    expect(serviceAreaKeys(area("Lake Hartwell"))).toEqual([
      "lake hartwell",
      "hartwell lake",
      "hart county",
      "franklin county",
      "stephens county",
    ]);
  });

  it("finds a listing's guide by neighborhood, then city", () => {
    expect(guideForLocation("Lake Hartwell", "Lavonia")?.slug).toBe("lake-hartwell");
    expect(guideForLocation(null, "Royston")?.slug).toBe("royston");
    expect(guideForLocation("Pine Valley", "Royston")?.slug).toBe("royston");
    expect(guideForLocation(null, "Athens")).toBeUndefined();
    expect(guideForLocation("Hidden Hills", "Bowman")).toBeUndefined();
  });
});
