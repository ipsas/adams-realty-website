import { describe, expect, it } from "vitest";
import { parseSearchParams } from "./params";
import { searchPageIndexing } from "./search-indexing";

const indexing = (query: string) =>
  searchPageIndexing(parseSearchParams(new URLSearchParams(query)));

const NOINDEX = { index: false, follow: true };

describe("searchPageIndexing", () => {
  it("indexes the bare search", () => {
    expect(indexing("")).toEqual({ canonical: "/homes", robots: undefined });
  });

  it("ignores unknown params such as tracking tags", () => {
    expect(indexing("utm_source=newsletter&utm_medium=email")).toEqual({
      canonical: "/homes",
      robots: undefined,
    });
  });

  it.each([
    ["q=Gainesville", "/homes?q=Gainesville"],
    ["q=zzzz", "/homes?q=zzzz"],
    ["mode=rent", "/homes?mode=rent"],
    ["mode=sold", "/homes?mode=sold"],
    ["beds=3", "/homes?beds=3"],
    ["sort=price_asc", "/homes?sort=price_asc"],
    ["page=2", "/homes?page=2"],
    ["types=land", "/homes?types=land"],
    ["waterfront=1", "/homes?waterfront=1"],
    ["kw=dock", "/homes?kw=dock"],
    ["bounds=-84,34,-83,35", "/homes?bounds=-84%2C34%2C-83%2C35"],
    ["q=Gainesville&beds=3&utm_source=x", "/homes?q=Gainesville&beds=3"],
  ])("noindexes %s with a self canonical", (query, canonical) => {
    expect(indexing(query)).toEqual({ canonical, robots: NOINDEX });
  });

  it("drops defaults from the canonical", () => {
    expect(indexing("mode=buy&sort=recommended&page=1")).toEqual({
      canonical: "/homes",
      robots: undefined,
    });
  });
});
