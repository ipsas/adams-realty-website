import { describe, expect, it } from "vitest";
import { ResoHttpError } from "./reso/client";
import { UnexpectedResponseError } from "./reso/provider";
import {
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
    const ids = Array.from({ length: 260 }, (_, i) => `O${i}`);
    const { deps, lines, requests, saved } = setup({ ids });
    await refreshOffices(deps);
    expect(requests.map((r) => r.length)).toEqual([50, 50, 50, 50]);
    expect(OFFICE_CHUNK).toBe(50);
    expect(saved.flat()).toHaveLength(200);
    expect(lines[0].line).toBe("office_lookup: requested=200 resolved=0 status=200");
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
