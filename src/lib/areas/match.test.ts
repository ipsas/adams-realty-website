import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { areas, findArea, normalizeAreaName } from "@/config/areas";
import { GEORGIA_COUNTIES } from "@/config/georgia-counties";
import { listings } from "@/db/schema";
import {
  areaCondition,
  areaKeyRows,
  areaMatchKeys,
  canonicalCountySql,
  COUNTY_NAME_EXCEPTIONS,
  countyDisplay,
  countyKeySpellings,
  guideForLocation,
  inAreaCounties,
  normalizeCounty,
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
    const match = (col: string, n: number) =>
      `(lower("listings"."${col}") like any(array[$${n}, $${n + 1}]::text[]) and ` +
      `btrim(regexp_replace(lower("listings"."${col}"), '[^a-z0-9]+', ' ', 'g')) = any(array[$${n + 2}, $${n + 3}]::text[]))`;
    expect(sql).toBe(
      `((${match("neighborhood", 1)} or ${match("water_body", 5)}) and ` +
        `(upper(btrim("listings"."state")) in ($9, $10) and ("listings"."county" is null or regexp_replace(btrim(regexp_replace(lower("listings"."county"), '[^a-z0-9]+', ' ', 'g')), ' county$', '') = any(array[$11, $12, $13]::text[]))))`,
    );
    const keys = ["%lake%", "%hartwell%", "lake hartwell", "hartwell lake"];
    expect(params).toEqual([...keys, ...keys, "GA", "GEORGIA", "hart", "franklin", "stephens"]);
  });

  it("adds the city clause only for town-level areas", () => {
    const { sql, params } = dialect.sqlToQuery(areaCondition(area("Toccoa")));
    expect(sql).toContain(`lower("listings"."city")`);
    expect(sql).toContain(" or ");
    expect(params).toEqual([
      ...["%toccoa%", "toccoa", "%toccoa%", "toccoa", "%toccoa%", "toccoa"],
      "GA",
      "GEORGIA",
      "stephens",
    ]);
    expect(dialect.sqlToQuery(areaCondition(area("Lake Lanier"))).sql).not.toContain("city");
  });

  it("never interpolates names into the SQL text", () => {
    const { sql } = dialect.sqlToQuery(
      areaCondition({
        name: "O'Brien Park",
        city: "Royston",
        aliases: ["'; drop table listings; --"],
        counties: ["'; drop table agents; --"],
      }),
    );
    expect(sql).not.toContain("drop");
    expect(sql).not.toContain("brien");
  });
});

describe("county scoping", () => {
  it("normalizes county spellings the way feeds vary them", () => {
    expect(normalizeCounty("Hart")).toBe("hart");
    expect(normalizeCounty("HART COUNTY")).toBe("hart");
    expect(normalizeCounty(" McIntosh  County ")).toBe("mcintosh");
    expect(normalizeCounty("Jeff Davis")).toBe("jeff davis");
  });

  it("keys DeKalb, McDuffie and McIntosh however they are spaced, cased or punctuated", () => {
    for (const v of ["De Kalb", "de kalb county", "Dekalb", "DEKALB County", "De'Kalb", "DeKalb"]) {
      expect(normalizeCounty(v)).toBe("dekalb");
    }
    for (const v of ["Mc Duffie", "McDuffie", "mc duffie county", "Mc'Duffie", "MCDUFFIE"]) {
      expect(normalizeCounty(v)).toBe("mcduffie");
    }
    for (const v of ["McIntosh", "Mc Intosh", "mc'intosh county"]) {
      expect(normalizeCounty(v)).toBe("mcintosh");
    }
    // Other two-word counties keep their space.
    expect(normalizeCounty("Ben Hill County")).toBe("ben hill");
    expect(normalizeCounty("JEFF DAVIS")).toBe("jeff davis");
  });

  it("lists the spellings a feed may use for a county key or its start", () => {
    expect(countyKeySpellings("dekalb")).toEqual(["dekalb", "de kalb"]);
    expect(countyKeySpellings("deka")).toEqual(["deka", "de ka"]);
    expect(countyKeySpellings("mcdu")).toEqual(["mcdu", "mc du"]);
    expect(countyKeySpellings("mc")).toEqual(["mc"]);
    expect(countyKeySpellings("de")).toEqual(["de"]);
    expect(countyKeySpellings("hall")).toEqual(["hall"]);
    expect(countyKeySpellings("ben hill")).toEqual(["ben hill"]);
  });

  it("groups an exception's split spelling with the joined one", () => {
    const { sql, params } = dialect.sqlToQuery(canonicalCountySql(listings.county));
    expect(sql).toContain(`replace(regexp_replace(`);
    expect(params).toEqual(Object.keys(COUNTY_NAME_EXCEPTIONS));
  });

  it("keeps Georgia listings with no county, or in one of the area's counties", () => {
    const { sql, params } = dialect.sqlToQuery(inAreaCounties(area("Jefferson")));
    expect(
      sql.startsWith(`(upper(btrim("listings"."state")) in ($1, $2) and ("listings"."county" is null or `),
    ).toBe(true);
    expect(params).toEqual(["GA", "GEORGIA", "jackson"]);
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
    const royston = ["franklin", "hart", "madison"];
    const lake = ["hart", "franklin", "stephens"];
    expect(areaKeyRows([area("Royston"), area("Lake Hartwell")])).toEqual([
      { slug: "royston", kind: "neighborhood", key: "royston", counties: royston },
      { slug: "royston", kind: "city", key: "royston", counties: royston },
      { slug: "lake-hartwell", kind: "neighborhood", key: "lake hartwell", counties: lake },
      { slug: "lake-hartwell", kind: "neighborhood", key: "hartwell lake", counties: lake },
    ]);
  });
});

describe("section towns (cities)", () => {
  it("matches a section town's city as well as the guide's own", () => {
    expect(areaMatchKeys(area("Braselton"))).toEqual({
      neighborhoods: ["braselton", "hoschton"],
      cities: ["braselton", "hoschton"],
    });
    // The lake rule is untouched: still no city fallback.
    expect(areaMatchKeys(area("Lake Lanier")).cities).toEqual([]);
  });

  it("emits a city key row for the section town, with the guide's counties", () => {
    expect(areaKeyRows([area("Braselton")])).toContainEqual({
      slug: "braselton",
      kind: "city",
      key: "hoschton",
      counties: ["jackson", "gwinnett", "hall", "barrow"],
    });
  });

  it("adds the section town to the city clause", () => {
    const { sql, params } = dialect.sqlToQuery(areaCondition(area("Braselton")));
    expect(sql).toContain(`lower("listings"."city")`);
    expect(params).toContain("hoschton");
    expect(params).toContain("%hoschton%");
  });

  it("finds the guide for a section-town listing, county-scoped", () => {
    expect(guideForLocation(null, "Hoschton", "Jackson")?.slug).toBe("braselton");
    expect(guideForLocation(null, "Hoschton", "Fulton")).toBeUndefined();
  });

  it("gives a section town no URL of its own", () => {
    // Guide routes and the sitemap resolve by slug only (src/lib/listings/cached.ts).
    expect(areas.map((a) => a.slug)).not.toContain("hoschton");
    expect(findArea("hoschton")?.slug).toBe("braselton");
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

  it("finds a lake named only in WaterBodyName, as real feeds do", () => {
    expect(guideForLocation("Cedar Cove", "Lavonia", "Franklin", "Lake Hartwell")?.slug).toBe(
      "lake-hartwell",
    );
    expect(guideForLocation("Harbour Point", "Gainesville", "Hall", "Lanier")?.slug).toBe(
      "lake-lanier",
    );
  });

  it("never matches a guide outside the listing's county", () => {
    // A statewide feed repeats names: a subdivision called "Jefferson" in Savannah.
    expect(guideForLocation("Jefferson", "Savannah", "Chatham")).toBeUndefined();
    expect(guideForLocation("Jefferson", "Jefferson", "Jackson")?.slug).toBe("jefferson");
    expect(guideForLocation("Jefferson", "Jefferson", "Jackson County")?.slug).toBe("jefferson");
    // A Martin in another county, and a "Lanier" lake name in Lanier County.
    expect(guideForLocation(null, "Martin", "Stephens")?.slug).toBe("martin");
    expect(guideForLocation(null, "Martin", "Coweta")).toBeUndefined();
    expect(guideForLocation("Oak Hill", "Lakeland", "Lanier", "Lanier")).toBeUndefined();
    // No county on the listing: the name alone decides, as before.
    expect(guideForLocation("Jefferson", "Savannah", null)?.slug).toBe("jefferson");
  });
});

describe("countyDisplay", () => {
  it("spells DeKalb, McDuffie and McIntosh their way, however the feed cases them", () => {
    expect(countyDisplay("DEKALB")).toBe("DeKalb County");
    expect(countyDisplay("Dekalb")).toBe("DeKalb County");
    expect(countyDisplay("De Kalb County")).toBe("DeKalb County");
    expect(countyDisplay("MCDUFFIE")).toBe("McDuffie County");
    expect(countyDisplay("mcduffie county")).toBe("McDuffie County");
    expect(countyDisplay("MCINTOSH COUNTY")).toBe("McIntosh County");
    expect(countyDisplay("BEN HILL")).toBe("Ben Hill County");
    expect(countyDisplay("jeff davis county")).toBe("Jeff Davis County");
  });

  it("shows every Georgia county correctly from capitals, lower case or as spelled", () => {
    expect(GEORGIA_COUNTIES).toHaveLength(159);
    for (const name of GEORGIA_COUNTIES) {
      for (const v of [name, name.toUpperCase(), name.toLowerCase()]) {
        expect(countyDisplay(v)).toBe(`${name} County`);
        expect(countyDisplay(`${v} County`)).toBe(`${name} County`);
      }
    }
  });

  it("needs an exception exactly for the counties Title Case gets wrong", () => {
    const title = (s: string) =>
      s.toLowerCase().replace(/(^|\s)([a-z])/g, (_, p, c) => p + c.toUpperCase());
    const odd = GEORGIA_COUNTIES.filter((n) => title(n) !== n);
    expect(Object.values(COUNTY_NAME_EXCEPTIONS)).toEqual(odd);
  });
});
