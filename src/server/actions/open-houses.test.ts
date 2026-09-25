import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/permissions";

// The actions run against mocked Drizzle chains: each `select` resolves to the
// next queued result, and inserts/deletes are recorded.
const h = vi.hoisted(() => {
  const state = {
    actor: null as Actor | null,
    selects: [] as unknown[][],
    inserted: [] as Record<string, unknown>[],
    deleted: 0,
    audits: [] as Record<string, unknown>[],
    revalidated: [] as string[],
  };
  function chain(result: unknown, onCall?: (method: string, args: unknown[]) => void) {
    const proxy: object = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then")
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(result).then(res, rej);
          return (...args: unknown[]) => {
            onCall?.(String(prop), args);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }
  const exec = {
    select: () => chain(state.selects.shift() ?? []),
    insert: () =>
      chain([{ id: "11111111-1111-4111-8111-111111111111" }], (m, args) => {
        if (m === "values") state.inserted.push(args[0] as Record<string, unknown>);
      }),
    delete: () =>
      chain(undefined, (m) => {
        if (m === "where") state.deleted++;
      }),
  };
  return { state, exec };
});

vi.mock("@/db", () => ({
  db: { ...h.exec, transaction: (fn: (tx: typeof h.exec) => unknown) => fn(h.exec) },
}));
vi.mock("@/lib/auth/session", () => ({ getActor: async () => h.state.actor }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => h.state.revalidated.push(p),
}));
vi.mock("@/server/audit", () => ({
  audit: async (_tx: unknown, entry: Record<string, unknown>) => h.state.audits.push(entry),
}));

const { addOpenHouse, deleteOpenHouse } = await import("./open-houses");

const LISTING_ID = "3c35a2fa-1318-4963-bb42-42923d5e6a96";
const OPEN_HOUSE_ID = "446d8255-d590-45b8-9b34-8f00f91a922b";
const DANIEL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const admin: Actor = { userId: "u-admin", role: "admin", agentId: null };
const daniel: Actor = { userId: "u-daniel", role: "agent", agentId: DANIEL };
const priya: Actor = { userId: "u-priya", role: "agent", agentId: "p" };

const listing = (over: Record<string, unknown> = {}) => ({
  id: LISTING_ID,
  slug: "12-oak-st-decatur-ga-30030-abc",
  status: "active",
  listAgentId: DANIEL,
  removedAt: null,
  sourceKind: "manual",
  ...over,
});

/** The row-locked re-read of the listing's status. */
const locked = { status: "active", removedAt: null };

const input = (over: Record<string, string> = {}) => ({
  date: "2026-10-03",
  startTime: "13:00",
  endTime: "15:00",
  type: "in_person",
  remarks: "",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Friday, Sep 25 2026, 8am Eastern.
  vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  Object.assign(h.state, {
    actor: daniel,
    selects: [],
    inserted: [],
    deleted: 0,
    audits: [],
    revalidated: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("addOpenHouse", () => {
  it("stores Eastern wall-clock times as UTC instants", async () => {
    h.state.selects = [[listing()], [locked], []];
    const res = await addOpenHouse(LISTING_ID, input({ remarks: "  Park   on the street " }));
    expect(res.ok).toBe(true);
    expect(h.state.inserted).toEqual([
      {
        listingId: LISTING_ID,
        type: "in_person",
        startsAt: new Date("2026-10-03T17:00:00Z"),
        endsAt: new Date("2026-10-03T19:00:00Z"),
        remarks: "Park on the street",
        sourceKey: null,
      },
    ]);
  });

  it("uses standard time after the DST change", async () => {
    h.state.selects = [[listing()], [locked], []];
    await addOpenHouse(LISTING_ID, input({ date: "2026-12-05", type: "virtual" }));
    expect(h.state.inserted[0]).toMatchObject({
      type: "virtual",
      startsAt: new Date("2026-12-05T18:00:00Z"),
      remarks: null,
    });
  });

  it("audits and revalidates the public pages", async () => {
    h.state.selects = [[listing()], [locked], []];
    await addOpenHouse(LISTING_ID, input());
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        actorId: "u-daniel",
        action: "listing.open_house.add",
        entityType: "listing",
        entityId: LISTING_ID,
      }),
    ]);
    expect(h.state.revalidated).toEqual(
      expect.arrayContaining([
        "/homes/12-oak-st-decatur-ga-30030-abc",
        "/homes",
        `/dashboard/listings/${LISTING_ID}`,
      ]),
    );
  });

  it.each([
    [{ endTime: "13:00" }, "endTime", "End time must be after the start time"],
    [{ endTime: "12:30" }, "endTime", "End time must be after the start time"],
    [{ startTime: "06:00", endTime: "19:00" }, "endTime", "Open houses can run up to 12 hours"],
    [
      { date: "2026-09-25", startTime: "07:00", endTime: "09:00" },
      "startTime",
      "That time has already passed",
    ],
    [{ date: "2027-12-01" }, "date", "Schedule open houses up to a year ahead"],
    [{ date: "10/03/2026" }, "date", "Choose a date"],
    [{ date: "2026-02-31" }, "date", "Choose a valid date"],
    [{ startTime: "1pm" }, "startTime", "Choose a start time"],
    [{ endTime: "24:30" }, "endTime", "Choose an end time"],
    [{ type: "hybrid" }, "type", "Choose in person or virtual"],
    [{ remarks: "x".repeat(201) }, "remarks", "Keep remarks under 200 characters"],
  ])("rejects %j", async (over, field, message) => {
    h.state.selects = [[listing()], [locked], []];
    const res = await addOpenHouse(LISTING_ID, input(over));
    expect(res.ok).toBe(false);
    expect(res.errors?.[field as keyof typeof res.errors]).toBe(message);
    expect(h.state.inserted).toHaveLength(0);
  });

  it("allows an open house later today", async () => {
    h.state.selects = [[listing()], [locked], []];
    const res = await addOpenHouse(LISTING_ID, input({ date: "2026-09-25", startTime: "09:00" }));
    expect(res.ok).toBe(true);
  });

  it("refuses overlapping open houses", async () => {
    h.state.selects = [
      [listing()],
      [locked],
      [{ startsAt: new Date("2026-10-03T18:00:00Z"), endsAt: new Date("2026-10-03T20:00:00Z") }],
    ];
    const res = await addOpenHouse(LISTING_ID, input());
    expect(res).toEqual({
      ok: false,
      message: "That overlaps the open house on Sat, Oct 3, 2 PM–4 PM.",
    });
    expect(h.state.inserted).toHaveLength(0);
    expect(h.state.revalidated).toHaveLength(0);
  });

  it("refuses sold and off-market listings", async () => {
    h.state.selects = [[listing({ status: "closed" })]];
    const res = await addOpenHouse(LISTING_ID, input());
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/sold or off market/);
    expect(h.state.inserted).toHaveLength(0);
  });

  it("re-checks the status under the lock in case a save just marked it sold", async () => {
    h.state.selects = [[listing()], [{ status: "closed", removedAt: null }]];
    const res = await addOpenHouse(LISTING_ID, input());
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/sold or off market/);
    expect(h.state.inserted).toHaveLength(0);
    expect(h.state.revalidated).toHaveLength(0);
  });

  it("lets admins schedule any manual listing", async () => {
    h.state.actor = admin;
    h.state.selects = [[listing({ listAgentId: null })], [locked], []];
    expect((await addOpenHouse(LISTING_ID, input())).ok).toBe(true);
  });

  it("forbids other agents, MLS listings and signed-out visitors", async () => {
    h.state.actor = priya;
    h.state.selects = [[listing()]];
    await expect(addOpenHouse(LISTING_ID, input())).rejects.toThrow("permission");

    h.state.actor = admin;
    h.state.selects = [[listing({ sourceKind: "reso_web_api" })]];
    await expect(addOpenHouse(LISTING_ID, input())).rejects.toThrow("permission");

    h.state.actor = { userId: "u-shopper", role: "user", agentId: null };
    await expect(addOpenHouse(LISTING_ID, input())).rejects.toThrow("permission");

    h.state.actor = null;
    await expect(addOpenHouse(LISTING_ID, input())).rejects.toThrow("sign in");
    expect(h.state.inserted).toHaveLength(0);
  });

  it("handles unknown listings", async () => {
    expect(await addOpenHouse("not-a-uuid", input())).toEqual({
      ok: false,
      message: "Listing not found.",
    });
    h.state.selects = [[]];
    expect((await addOpenHouse(LISTING_ID, input())).message).toBe("Listing not found.");
  });
});

describe("deleteOpenHouse", () => {
  const row = {
    listingId: LISTING_ID,
    startsAt: new Date("2026-10-03T17:00:00Z"),
    endsAt: new Date("2026-10-03T19:00:00Z"),
  };

  it("deletes, audits and revalidates", async () => {
    h.state.selects = [[row], [listing()], []];
    const res = await deleteOpenHouse(OPEN_HOUSE_ID);
    expect(res).toEqual({ ok: true, message: "Removed the open house on Sat, Oct 3, 1 PM." });
    expect(h.state.deleted).toBe(1);
    expect(h.state.audits[0]).toMatchObject({ action: "listing.open_house.delete" });
    expect(h.state.revalidated).toContain("/homes/12-oak-st-decatur-ga-30030-abc");
  });

  it("explains a stale id", async () => {
    h.state.selects = [[]];
    const res = await deleteOpenHouse(OPEN_HOUSE_ID);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Refresh/);
    expect(h.state.deleted).toBe(0);
  });

  it("forbids other agents", async () => {
    h.state.actor = priya;
    h.state.selects = [[row], [listing()]];
    await expect(deleteOpenHouse(OPEN_HOUSE_ID)).rejects.toThrow("permission");
    expect(h.state.deleted).toBe(0);
  });
});
