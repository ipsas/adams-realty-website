import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  inMarketState,
  isMarketState,
  MARKET_STATE_SPELLINGS,
  normalizeState,
} from "./market-state";

describe("normalizeState", () => {
  it("stores Georgia as its code, however it is spelled", () => {
    for (const s of ["Georgia", "GEORGIA", " georgia ", "GA", " ga ", "Ga"]) {
      expect(normalizeState(s), s).toBe("GA");
    }
  });

  it("trims and upper-cases other states", () => {
    expect(normalizeState("AL")).toBe("AL");
    expect(normalizeState(" nc ")).toBe("NC");
    expect(normalizeState("south   carolina")).toBe("SOUTH CAROLINA");
    expect(normalizeState("")).toBe("");
  });
});

describe("isMarketState", () => {
  it("is true for Georgia in any spelling", () => {
    for (const s of ["GA", "ga", " GA ", "Georgia", "GEORGIA"]) {
      expect(isMarketState(s), s).toBe(true);
    }
  });

  it("is false for other states, empty and missing", () => {
    for (const s of ["AL", "NC", "SC", "FL", "", "  ", null, undefined]) {
      expect(isMarketState(s), String(s)).toBe(false);
    }
  });
});

describe("inMarketState", () => {
  it("compares the trimmed, upper-cased state with the spellings, as bound parameters", () => {
    const { sql, params } = new PgDialect().sqlToQuery(inMarketState());
    expect(sql).toBe(`upper(btrim("listings"."state")) in ($1, $2)`);
    expect(params).toEqual(MARKET_STATE_SPELLINGS);
    expect(MARKET_STATE_SPELLINGS).toEqual(["GA", "GEORGIA"]);
  });
});
