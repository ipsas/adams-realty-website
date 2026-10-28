import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { schoolOptionsQuery } from "./school-options";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

// The school filters' suggestions: one per school however the feed spells it, Georgia only.

const options = () => schoolOptionsQuery(db);
const all = (elementary: string, middle = "Hart County", high = "Hart County") => ({
  schools: { elementary, middle, high },
});

beforeEach(resetDb);
afterAll(closeDb);

describe("schoolOptionsQuery", () => {
  it("is empty and not partial with no listings", async () => {
    expect(await options()).toEqual({ elementary: [], middle: [], high: [], partial: false });
  });

  it("offers one option per school, most common spelling formatted, no placeholders", async () => {
    const source = await createSource({ slug: "adams", kind: "manual", config: {} });
    await insertListings(source, [
      listing(1, all("NORTH HART")),
      listing(2, all("North Hart ")),
      listing(3, all("NORTH HART")),
      listing(4, all("Other")),
      listing(5, all("Bowman")),
      // Another state's school is not offered.
      listing(6, { state: "NE", county: "Hall", ...all("Grand Island", "Walnut", "Hart") }),
    ]);
    const out = await options();
    expect(out.elementary).toEqual(["Bowman", "North Hart"]);
    expect(out.middle).toEqual(["Hart County"]);
    expect(out.high).toEqual(["Hart County"]);
    expect(out.elementary).not.toContain("Other");
  });

  it("is partial when under 98% of active sales name all three schools", async () => {
    const source = await createSource({ slug: "adams", kind: "manual", config: {} });
    await insertListings(source, [
      listing(1, all("North Hart")),
      listing(2, { schools: { elementary: "North Hart", middle: "Hart County", high: "Other" } }),
    ]);
    expect((await options()).partial).toBe(true);
  });

  it("is not partial when every active sale names all three", async () => {
    const source = await createSource({ slug: "adams", kind: "manual", config: {} });
    await insertListings(source, [
      listing(1, all("North Hart")),
      listing(2, all("Bowman")),
      // Not counted: a closed sale, and a listing outside Georgia.
      listing(3, { status: "closed", closeDate: "2026-09-10", schools: {} }),
      listing(4, { state: "NE", schools: {} }),
    ]);
    expect((await options()).partial).toBe(false);
  });
});
