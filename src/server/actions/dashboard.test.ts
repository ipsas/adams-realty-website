import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/permissions";
import type { NormalizedListing } from "@/lib/mls/types";

// saveListing against mocked Drizzle chains: each `select` resolves to the
// next queued result; upsertListing is mocked to capture what would be written.
const h = vi.hoisted(() => {
  const state = {
    actor: null as Actor | null,
    selects: [] as unknown[][],
    upserts: [] as NormalizedListing[],
  };
  function chain(result: unknown) {
    const proxy: object = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then")
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(result).then(res, rej);
          return () => proxy;
        },
      },
    );
    return proxy;
  }
  const exec = { select: () => chain(state.selects.shift() ?? []) };
  return { state, exec };
});

vi.mock("@/db", () => ({
  db: { ...h.exec, transaction: (fn: (tx: typeof h.exec) => unknown) => fn(h.exec) },
}));
vi.mock("@/lib/auth/session", () => ({ getActor: async () => h.state.actor }));
vi.mock("@/lib/geocode", () => ({ geocodeAddress: async () => null }));
vi.mock("@/lib/mls/sync", () => ({ syncSource: vi.fn() }));
vi.mock("@/lib/listings/persist", () => ({
  upsertListing: async (_tx: unknown, _source: unknown, n: NormalizedListing) => {
    h.state.upserts.push(n);
    return { id: LISTING_ID, created: false };
  },
}));
vi.mock("@/server/audit", () => ({ audit: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const { saveListing } = await import("./dashboard");

const LISTING_ID = "3c35a2fa-1318-4963-bb42-42923d5e6a96";
const SOURCE_ID = "b35e5476-2b15-4c16-908b-020063e6a746";
const DANIEL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const daniel: Actor = { userId: "u-daniel", role: "agent", agentId: DANIEL };

const source = { id: SOURCE_ID, slug: "adams", kind: "manual", config: {} };
const agent = { id: DANIEL, name: "Daniel Reyes", phone: null, email: "d@example.com" };
const existing = {
  id: LISTING_ID,
  sourceId: SOURCE_ID,
  slug: "12-oak-st-decatur-ga-30030-abc",
  listingKey: "ADAMS-1234ABCD",
  mlsNumber: null,
  status: "active",
  listAgentId: DANIEL,
  addressLine1: "12 Oak St",
  postalCode: "30030",
  latitude: 33.77,
  longitude: -84.29,
  listDate: "2026-09-01",
  originalListPrice: 500_000,
  statusChangedAt: new Date("2026-09-01T12:00:00Z"),
  features: {
    interior: ["Fireplace"],
    parking: ["Carport"],
    heating: ["Heat pump"],
    flooring: ["Hardwood"],
  },
  schools: {},
};
const openHouse = {
  sourceKey: null,
  type: "in_person",
  startsAt: new Date("2026-10-03T17:00:00Z"),
  endsAt: new Date("2026-10-03T19:00:00Z"),
  remarks: "Park on the street",
};
const floorPlan = {
  sourceKey: null,
  url: "https://cdn.example.com/plan.pdf",
  kind: "floor_plan",
  caption: "Main level",
  width: null,
  height: null,
};

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const fields: Record<string, string> = {
    id: LISTING_ID,
    status: "active",
    transactionType: "sale",
    propertyType: "single_family",
    listPrice: "495000",
    addressLine1: "12 Oak St",
    city: "Decatur",
    state: "GA",
    postalCode: "30030",
    latitude: "33.77",
    longitude: "-84.29",
    photos: "[]",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Queues the reads saveListing makes when updating an existing listing. */
function queueUpdate(opts: { opens?: unknown[]; otherMedia?: unknown[] } = {}) {
  h.state.selects = [
    [source],
    [existing],
    [agent],
    [], // row lock
    opts.otherMedia ?? [],
    opts.opens ?? [],
  ];
}

beforeEach(() => {
  Object.assign(h.state, { actor: daniel, selects: [], upserts: [] });
});

describe("saveListing", () => {
  it("keeps the listing's open houses (upsertListing replaces them)", async () => {
    queueUpdate({ opens: [openHouse] });
    const res = await saveListing({ ok: false }, form());
    expect(res.ok).toBe(true);
    expect(h.state.upserts[0].openHouses).toEqual([openHouse]);
  });

  it("keeps floor plans and other non-photo media after the photos", async () => {
    queueUpdate({ otherMedia: [floorPlan] });
    await saveListing(
      { ok: false },
      form({ photos: JSON.stringify([{ url: "https://cdn.example.com/front.jpg", caption: "" }]) }),
    );
    expect(h.state.upserts[0].media).toEqual([
      expect.objectContaining({
        url: "https://cdn.example.com/front.jpg",
        kind: "photo",
        sortOrder: 0,
      }),
      { ...floorPlan, sortOrder: 1 },
    ]);
  });

  it("stores photo order and captions from the photo manager", async () => {
    queueUpdate();
    const photos = [
      { url: "https://cdn.example.com/kitchen.jpg", caption: "  Kitchen " },
      { url: "https://cdn.example.com/front.jpg", caption: null },
      { url: "https://cdn.example.com/kitchen.jpg", caption: "Duplicate" },
    ];
    await saveListing({ ok: false }, form({ photos: JSON.stringify(photos) }));
    expect(h.state.upserts[0].media.map((m) => [m.url, m.caption, m.sortOrder])).toEqual([
      ["https://cdn.example.com/kitchen.jpg", "Kitchen", 0],
      ["https://cdn.example.com/front.jpg", null, 1],
    ]);
  });

  it("still accepts the one-URL-per-line format", async () => {
    queueUpdate();
    await saveListing(
      { ok: false },
      form({ photos: "https://cdn.example.com/a.jpg\nnot a url\nhttp://cdn.example.com/b.jpg" }),
    );
    expect(h.state.upserts[0].media.map((m) => m.url)).toEqual(["https://cdn.example.com/a.jpg"]);
  });

  it("rejects photo links that aren't https", async () => {
    queueUpdate();
    const res = await saveListing(
      { ok: false },
      form({ photos: JSON.stringify([{ url: "http://cdn.example.com/a.jpg", caption: null }]) }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors?.photos).toBe("Photos must be https:// links.");
    expect(h.state.upserts).toHaveLength(0);
  });

  it("edits feature groups and keeps the ones the form doesn't show", async () => {
    queueUpdate();
    await saveListing(
      { ok: false },
      form({
        features_interior: "Fireplace, walk-in closet ,, Fireplace; Vaulted ceilings",
        features_parking: "",
        features_community: "Pool\nSidewalks",
      }),
    );
    expect(h.state.upserts[0].features).toEqual({
      interior: ["Fireplace", "walk-in closet", "Vaulted ceilings"],
      community: ["Pool", "Sidewalks"],
      heating: ["Heat pump"],
      flooring: ["Hardwood"],
    });
  });

  it("returns the save stamp so the form can remount", async () => {
    queueUpdate();
    const res = await saveListing({ ok: false }, form());
    expect(res.savedAt).toEqual(expect.any(Number));
  });

  it("forbids agents from saving someone else's listing", async () => {
    h.state.actor = { userId: "u-priya", role: "agent", agentId: "p" };
    queueUpdate();
    await expect(saveListing({ ok: false }, form())).rejects.toThrow("permission");
    expect(h.state.upserts).toHaveLength(0);
  });

  it("creates new listings with no open houses", async () => {
    h.state.selects = [[source], [agent]];
    await expect(saveListing({ ok: false }, form({ id: "" }))).rejects.toThrow(
      `NEXT_REDIRECT /dashboard/listings/${LISTING_ID}?created=1`,
    );
    expect(h.state.upserts[0].openHouses).toEqual([]);
    expect(h.state.upserts[0].listingKey).toMatch(/^ADAMS-/);
  });
});
