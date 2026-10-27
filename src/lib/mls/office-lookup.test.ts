import { describe, expect, it } from "vitest";
import { ResoHttpError } from "./reso/client";
import { UnexpectedResponseError } from "./reso/provider";
import {
  OFFICE_BATCH_MIN_REMAINING_MS,
  OFFICE_BATCH_PAUSE_MS,
  OFFICE_CHUNK,
  OFFICE_FRESH_MS,
  OFFICE_RUN_CAP,
  refreshOffices,
  type OfficeLookupDeps,
} from "./office-lookup";
import type { MlsOffice } from "./types";

const NOW = Date.UTC(2026, 9, 26, 12);

/** The step against in-memory fakes; `lines` holds what it logged. */
function setup(over: Partial<OfficeLookupDeps> & { ids?: string[] } = {}) {
  const lines: { level: "info" | "warn"; line: string }[] = [];
  const saved: MlsOffice[][] = [];
  const requests: string[][] = [];
  const asked: { limit: number; staleBefore: Date }[] = [];
  const ids = over.ids ?? ["RMCR", "XXXX"];
  const deps: OfficeLookupDeps = {
    officeIdsNeedingLookup: async (limit, staleBefore) => {
      asked.push({ limit, staleBefore });
      return ids.slice(0, limit);
    },
    fetchOffices: async (chunk) => {
      requests.push(chunk);
      return chunk
        .filter((id) => id === "RMCR")
        .map(() => ({
          officeMlsId: "RMCR",
          officeName: "Re/Max Center",
        }));
    },
    saveOffices: async (offices) => {
      saved.push(offices);
    },
    log: {
      info: (line) => lines.push({ level: "info", line }),
      warn: (line) => lines.push({ level: "warn", line }),
    },
    now: () => NOW,
    sleep: async () => {},
    ...over,
  };
  return { deps, lines, saved, requests, asked };
}

describe("refreshOffices", () => {
  it("saves every requested ID, unknown ones with a null name, and logs one success line", async () => {
    const { deps, lines, saved, asked } = setup();
    await expect(refreshOffices(deps)).resolves.toBe(1);
    expect(saved).toEqual([
      [
        { officeMlsId: "RMCR", officeName: "Re/Max Center" },
        { officeMlsId: "XXXX", officeName: null },
      ],
    ]);
    expect(asked).toEqual([
      { limit: OFFICE_RUN_CAP, staleBefore: new Date(NOW - OFFICE_FRESH_MS) },
    ]);
    expect(lines).toEqual([
      { level: "info", line: "office_lookup: requested=2 resolved=1 status=200" },
    ]);
  });

  it("asks for at most OFFICE_RUN_CAP IDs, OFFICE_CHUNK per request", async () => {
    const ids = Array.from({ length: 1260 }, (_, i) => `O${i}`);
    const { deps, lines, requests, saved, asked } = setup({ ids });
    await refreshOffices(deps);
    expect(OFFICE_RUN_CAP).toBe(1000);
    expect(OFFICE_CHUNK).toBe(50);
    expect(asked.map((a) => a.limit)).toEqual([1000]);
    expect(requests.map((r) => r.length)).toEqual(Array(20).fill(50));
    expect(saved.flat()).toHaveLength(1000);
    expect(lines).toEqual([
      { level: "info", line: "office_lookup: requested=1000 resolved=0 status=200" },
    ]);
  });

  it("sends the batches one at a time, pausing between them only", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `O${i}`);
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const { deps } = setup({
      ids,
      fetchOffices: async () => {
        events.push("fetch");
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise<void>((r) => queueMicrotask(r));
        inFlight--;
        return [];
      },
      sleep: async (ms) => {
        events.push(`sleep ${ms}`);
      },
    });
    await refreshOffices(deps);
    expect(maxInFlight).toBe(1);
    expect(events.filter((e) => e === "fetch")).toHaveLength(20);
    expect(events.filter((e) => e !== "fetch")).toEqual(
      Array(19).fill(`sleep ${OFFICE_BATCH_PAUSE_MS}`),
    );
    expect(OFFICE_BATCH_PAUSE_MS).toBe(250);
    expect(events[0]).toBe("fetch");
    expect(events.at(-1)).toBe("fetch");
  });

  it("stops before a batch that would start too close to the deadline", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `O${i}`);
    let clock = NOW;
    const requests: string[][] = [];
    const { deps, lines, saved } = setup({
      ids,
      now: () => clock,
      // 4 batches fit: each takes 10 s, and the 5th would start with 10 s left.
      deadline: NOW + 4 * 10_000 + OFFICE_BATCH_MIN_REMAINING_MS - 5_000,
      fetchOffices: async (chunk) => {
        requests.push(chunk);
        clock += 10_000;
        return [{ officeMlsId: chunk[0], officeName: "Named" }];
      },
    });
    expect(OFFICE_BATCH_MIN_REMAINING_MS).toBe(15_000);
    await expect(refreshOffices(deps)).resolves.toBe(4);
    expect(requests).toHaveLength(4);
    expect(saved.flat()).toHaveLength(200);
    expect(lines).toEqual([
      { level: "info", line: "office_lookup: requested=200 resolved=4 status=200" },
    ]);
  });

  it("with too little time left asks the feed nothing", async () => {
    const { deps, lines, requests } = setup({
      deadline: NOW + OFFICE_BATCH_MIN_REMAINING_MS - 1,
    });
    await expect(refreshOffices(deps)).resolves.toBe(0);
    expect(requests).toEqual([]);
    expect(lines).toEqual([
      { level: "info", line: "office_lookup: requested=0 resolved=0 status=200" },
    ]);
  });

  it("without a deadline sends every batch", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `O${i}`);
    let clock = NOW;
    const { deps, requests } = setup({
      ids,
      now: () => clock,
      fetchOffices: async (chunk) => {
        requests.push(chunk);
        clock += 60_000;
        return [];
      },
    });
    await refreshOffices(deps);
    expect(requests).toHaveLength(20);
  });

  it("a failing second batch ends the step: no third request", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `O${i}`);
    const requests: string[][] = [];
    const { deps, lines, saved } = setup({
      ids,
      fetchOffices: async (chunk) => {
        requests.push(chunk);
        if (requests.length === 2) throw new ResoHttpError("RESO request failed (503)", 503);
        return [];
      },
    });
    await expect(refreshOffices(deps)).resolves.toBe(0);
    expect(requests).toHaveLength(2);
    expect(saved).toHaveLength(1);
    expect(lines).toEqual([
      { level: "warn", line: "office_lookup: requested=100 resolved=0 status=503 resource=Office" },
    ]);
  });

  it("with nothing to look up asks the feed nothing", async () => {
    const { deps, lines, requests } = setup({ ids: [] });
    await expect(refreshOffices(deps)).resolves.toBe(0);
    expect(requests).toEqual([]);
    expect(lines).toEqual([
      { level: "info", line: "office_lookup: requested=0 resolved=0 status=skipped" },
    ]);
  });

  it("on a 401 stops and warns once, with no URL, token or body", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `O${i}`);
    const { deps, lines, requests, saved } = setup({
      ids,
      fetchOffices: async (chunk) => {
        requests.push(chunk);
        throw new ResoHttpError(
          "RESO request failed (401) for https://feed.example.com/Office?access_token=***: denied",
          401,
        );
      },
    });
    await expect(refreshOffices(deps)).resolves.toBe(0);
    expect(requests).toHaveLength(1);
    expect(saved).toEqual([]);
    expect(lines).toEqual([
      { level: "warn", line: "office_lookup: requested=50 resolved=0 status=401 resource=Office" },
    ]);
    expect(lines[0].line).not.toMatch(/http|token|\?|denied/i);
  });

  it("names a timeout, a bad response and a database failure without their messages", async () => {
    const cases: [Partial<OfficeLookupDeps>, string][] = [
      [
        {
          fetchOffices: async () => {
            throw new Error(
              "RESO request failed after 1 attempts for https://x?token=1: TimeoutError",
            );
          },
        },
        "office_lookup: requested=2 resolved=0 status=error resource=Office reason=timeout",
      ],
      [
        {
          fetchOffices: async () => {
            throw new UnexpectedResponseError("Office");
          },
        },
        "office_lookup: requested=2 resolved=0 status=error resource=Office reason=shape",
      ],
      [
        {
          officeIdsNeedingLookup: async () => {
            throw new Error("connect ECONNREFUSED");
          },
        },
        "office_lookup: requested=0 resolved=0 status=error resource=Office reason=db",
      ],
      [
        {
          saveOffices: async () => {
            throw new Error("relation mls_offices does not exist");
          },
        },
        "office_lookup: requested=2 resolved=1 status=error resource=Office reason=db",
      ],
    ];
    for (const [over, line] of cases) {
      const { deps, lines } = setup(over);
      await expect(refreshOffices(deps)).resolves.toBe(0);
      expect(lines).toEqual([{ level: "warn", line }]);
    }
  });
});
