import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncResult } from "./sync-engine";

const h = vi.hoisted(() => ({
  events: [] as string[],
  officeDeadlines: [] as (number | undefined)[],
  sources: [] as { id: string; slug: string; config: Record<string, unknown> }[],
  mode: "incremental" as string,
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (_col: unknown, value: unknown) => ({ value }),
  and: (...conds: unknown[]) => ({ and: conds }),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async (cond: { value?: unknown }) => {
          const one = h.sources.find((s) => s.id === cond.value);
          return one ? [{ ...one, kind: "reso_web_api" }] : h.sources;
        },
      }),
    }),
  },
}));
vi.mock("@/lib/listings/places", () => ({ refreshPlaces: async () => {} }));
vi.mock("./gamls", () => ({ ownOfficeIds: () => [] }));
vi.mock("./sync-alerts", () => ({
  adminRecipients: async () => [],
  sendSyncAlert: async () => {},
}));
vi.mock("./sync-store", () => ({ createSyncStore: () => ({ changedListings: () => false }) }));
vi.mock("./reso/provider", () => ({
  missingCredentials: () => null,
  ResoWebApiProvider: class {
    constructor(readonly config: { slug: string }) {}
    async fetchOffices() {
      return [];
    }
  },
}));
vi.mock("./office-lookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./office-lookup")>()),
  officeLookupStore: (_db: unknown, sourceId: string) => ({ sourceId }),
  refreshOffices: async (deps: { sourceId: string; deadline?: number }) => {
    h.events.push(`offices:${deps.sourceId}`);
    h.officeDeadlines.push(deps.deadline);
    return 1;
  },
}));
vi.mock("./sync-engine", () => ({
  runSync: async (
    _store: unknown,
    feed: () => { config: { slug: string } },
    opts: { mode?: string },
  ): Promise<Partial<SyncResult>> => {
    h.events.push(`sync:${feed().config.slug}`);
    return { mode: (opts.mode ?? "incremental") as SyncResult["mode"], changed: false };
  },
}));

const { syncAllSources, syncSource, OFFICE_MAX_MS } = await import("./sync");
const { OFFICE_MIN_REMAINING_MS } = await import("./office-lookup");

function source(slug: string) {
  return { id: `id-${slug}`, slug, config: { slug } };
}

beforeEach(() => {
  h.events.length = 0;
  h.officeDeadlines.length = 0;
  h.sources = [source("a"), source("b")];
});

describe("syncAllSources: office lookups", () => {
  it("syncs every source before any office lookup", async () => {
    const results = await syncAllSources();
    expect(h.events).toEqual(["sync:a", "sync:b", "offices:id-a", "offices:id-b"]);
    // A named office marks the source changed, so the caller refreshes the caches.
    expect(results.map((r) => r.ok && r.result.changed)).toEqual([true, true]);
  });

  it("caps each office lookup at OFFICE_MAX_MS, within the run's deadline", async () => {
    const before = Date.now();
    await syncAllSources({ deadline: before + 10 * 60_000 });
    for (const d of h.officeDeadlines) {
      expect(d).toBeGreaterThanOrEqual(before + OFFICE_MAX_MS);
      expect(d).toBeLessThanOrEqual(Date.now() + OFFICE_MAX_MS);
    }
    expect(h.officeDeadlines).toHaveLength(2);
  });

  it("keeps the run's deadline when it is nearer than OFFICE_MAX_MS", async () => {
    const deadline = Date.now() + 30_000;
    await syncAllSources({ deadline });
    expect(h.officeDeadlines).toEqual([deadline, deadline]);
  });

  it("skips the office lookup with less than OFFICE_MIN_REMAINING_MS left", async () => {
    await syncAllSources({ deadline: Date.now() + OFFICE_MIN_REMAINING_MS - 1_000 });
    expect(h.events).toEqual(["sync:a", "sync:b"]);
  });

  it("skips the office lookup on a purge", async () => {
    await syncAllSources({ mode: "purge" });
    expect(h.events).toEqual(["sync:a", "sync:b"]);
  });
});

describe("syncSource: office lookup", () => {
  it("runs after the sync, capped at OFFICE_MAX_MS", async () => {
    const before = Date.now();
    const result = await syncSource("id-a", { deadline: before + 240_000 });
    expect(h.events).toEqual(["sync:a", "offices:id-a"]);
    expect(h.officeDeadlines[0]).toBeLessThanOrEqual(Date.now() + OFFICE_MAX_MS);
    expect(result.changed).toBe(true);
  });
});
