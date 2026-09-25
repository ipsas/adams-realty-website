import { describe, expect, it } from "vitest";
import { MAX_PAGE_MS, MAX_RETRIES, MAX_RETRY_DELAY_MS, ResoClient } from "./client";

// The client against a scripted fetch on a fake clock: every wait is bounded,
// so one page can never outlast a sync's time budget or heartbeat window.

const START = Date.parse("2026-09-25T09:00:00Z");

function harness(respond: (call: number, init: RequestInit) => Promise<Response> | Response) {
  let now = START;
  const sleeps: number[] = [];
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    return respond(calls.length, init);
  }) as unknown as typeof fetch;
  const make = (extra: Partial<ConstructorParameters<typeof ResoClient>[0]> = {}) =>
    new ResoClient({
      baseUrl: "https://feed.example.com/odata/",
      token: "t",
      fetchImpl,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      ...extra,
    });
  return {
    make,
    sleeps,
    calls,
    elapsed: () => now - START,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const ok = (value: unknown[]) => Response.json({ value });
const status = (code: number, headers: Record<string, string> = {}) =>
  new Response("busy", { status: code, headers });

describe("ResoClient", () => {
  it("reads one page and ignores @odata.nextLink (the provider pages by keyset)", async () => {
    const h = harness(() =>
      Response.json({ value: [{ ListingKey: "A" }], "@odata.nextLink": "https://x/?$skip=1" }),
    );
    const rows = await h.make().getPage("Property", { $top: "1" });
    expect(rows).toEqual([{ ListingKey: "A" }]);
    expect(h.calls).toHaveLength(1);
  });

  it("caps a server's Retry-After instead of sleeping an hour", async () => {
    const h = harness((n) => (n === 1 ? status(429, { "retry-after": "3600" }) : ok([])));
    await h.make().getPage("Property", {});
    expect(h.sleeps).toEqual([MAX_RETRY_DELAY_MS]);
  });

  it("times out a request that hangs, and retries it", async () => {
    const h = harness(
      (n, init) =>
        new Promise<Response>((resolve, reject) => {
          if (n > 1) return resolve(ok([{ ListingKey: "B" }]));
          // Never answers: only the client's timeout ends it.
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const rows = await h.make({ requestTimeoutMs: 20 }).getPage("Property", {});
    expect(rows).toEqual([{ ListingKey: "B" }]);
    expect(h.calls).toHaveLength(2);
    expect(h.calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
  });

  it("retries a network error", async () => {
    const h = harness((n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return ok([]);
    });
    await expect(h.make().getPage("Property", {})).resolves.toEqual([]);
    expect(h.calls).toHaveLength(2);
  });

  it("never waits past the deadline: it fails instead", async () => {
    const h = harness(() => status(503, { "retry-after": "20" }));
    const client = h.make({ deadline: START + 30_000 });
    await expect(client.getPage("Property", {})).rejects.toThrow(/past the time limit/);
    expect(h.elapsed()).toBeLessThanOrEqual(30_000);
    expect(h.sleeps).toEqual([20_000]);
  });

  it("gives up on one page after MAX_PAGE_MS, even with no deadline (CLI)", async () => {
    // Each answer takes 50 s and is a 503.
    const h = harness(() => {
      h.advance(50_000);
      return status(503);
    });
    await expect(h.make().getPage("Property", {})).rejects.toThrow(/RESO request gave up/);
    expect(h.elapsed()).toBeLessThanOrEqual(MAX_PAGE_MS + 50_000);
  });

  it(`stops after ${MAX_RETRIES} retries`, async () => {
    const h = harness(() => status(502));
    await expect(h.make().getPage("Property", {})).rejects.toThrow(/after 6 attempts.*HTTP 502/);
    expect(h.calls).toHaveLength(MAX_RETRIES + 1);
  });

  it("doesn't retry a client error", async () => {
    const h = harness(() => new Response("bad filter", { status: 400 }));
    await expect(h.make().getPage("Property", {})).rejects.toThrow(/\(400\).*bad filter/);
    expect(h.calls).toHaveLength(1);
  });
});
