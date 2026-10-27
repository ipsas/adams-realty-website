import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { bedroomOnMainDataUpdatingQuery } from "./bedroom-on-main-updating";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

// The "still updating" notice: an active RESO feed with listings not yet remapped to v4.

const updating = () => bedroomOnMainDataUpdatingQuery(db);
const BASE = { baseUrl: "https://feed.example.com/odata" };

beforeEach(resetDb);
afterAll(closeDb);

describe("bedroomOnMainDataUpdatingQuery", () => {
  it("is false with no sources", async () => {
    expect(await updating()).toBe(false);
  });

  it("is true for an active feed with listings on mapper version 3", async () => {
    const source = await createSource({ config: { ...BASE, mapperVersion: 3 } });
    await insertListings(source, [listing(1)]);
    expect(await updating()).toBe(true);
  });

  it("is false once the feed is on mapper version 4", async () => {
    const source = await createSource({ config: { ...BASE, mapperVersion: 4 } });
    await insertListings(source, [listing(1)]);
    expect(await updating()).toBe(false);
  });

  it("is true with no mapper version saved", async () => {
    const source = await createSource({ config: BASE });
    await insertListings(source, [listing(1)]);
    expect(await updating()).toBe(true);
  });

  it("is false for an inactive feed", async () => {
    const source = await createSource({ isActive: false, config: { ...BASE, mapperVersion: 3 } });
    await insertListings(source, [listing(1)]);
    expect(await updating()).toBe(false);
  });

  it("is false for a feed with no listings", async () => {
    await createSource({ config: { ...BASE, mapperVersion: 3 } });
    expect(await updating()).toBe(false);
  });
});
