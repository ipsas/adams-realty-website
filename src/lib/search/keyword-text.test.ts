import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { keywordText, keywordTsv } from "./keyword-text";

// What keyword_tsv indexes: the listing text as shown, codes masked.

const base = {
  addressLine1: "12 Main St",
  city: "Royston",
  postalCode: "30662",
  neighborhood: null,
  mlsNumber: "10100001",
  headline: null,
  propertySubType: "Single Family Residence",
  description: null,
  features: {},
};

describe("keywordText", () => {
  it("joins the location, headline, type and description", () => {
    expect(keywordText({ ...base, headline: "Lake view", description: "Cozy." })).toBe(
      "12 Main St Royston 30662 10100001 Lake view Single Family Residence Cozy.",
    );
  });

  it("masks access codes in the description", () => {
    const text = keywordText({ ...base, description: "Charming ranch. Gate code 4521. Dock." });
    expect(text).not.toContain("4521");
    expect(text).toContain("Charming ranch. Gate code ****");
  });

  it("masks each features string on its own, however deeply nested, and never reads keys", () => {
    const text = keywordText({
      ...base,
      features: {
        security: ["Gate code 4455"],
        nested: { deeper: [{ note: "Lockbox code 9876" }], other: "Clubhouse" },
      },
    });
    expect(text).not.toContain("4455");
    expect(text).not.toContain("9876");
    expect(text).toContain("Clubhouse");
    expect(text).not.toMatch(/security|nested|deeper|note/);
  });

  it("reads '/' as a space, in the description and in features", () => {
    const text = keywordText({
      ...base,
      description: "Living room/kitchen/dining combo",
      features: { appliances: ["Washer/Dryer"] },
    });
    expect(text).toContain("Living room kitchen dining combo");
    expect(text).toContain("Washer Dryer");
    expect(text).not.toContain("/");
  });

  it("keeps a features string with no code as is", () => {
    expect(keywordText({ ...base, features: { interior: ["Dining combo"] } })).toContain(
      "Dining combo",
    );
  });

  it("ignores features values that aren't strings", () => {
    const text = keywordText({
      ...base,
      features: { garage: 2, pool: true, hoa: null, rooms: [3, false, "Den"] },
    });
    expect(text).toBe("12 Main St Royston 30662 10100001 Single Family Residence Den");
  });

  it("reads null or missing fields as empty", () => {
    expect(keywordText({})).toBe("");
    expect(keywordText({ ...base, addressLine1: null, features: null })).toBe(
      "Royston 30662 10100001 Single Family Residence",
    );
  });
});

describe("keywordTsv", () => {
  it("is to_tsvector('english') of the text, as a parameter", () => {
    const q = new PgDialect().sqlToQuery(keywordTsv("barn workshop"));
    expect(q.sql).toBe("to_tsvector('english', $1::text)");
    expect(q.params).toEqual(["barn workshop"]);
  });
});
