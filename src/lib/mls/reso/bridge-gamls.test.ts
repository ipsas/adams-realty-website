import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { gamlsBaseUrl, gamlsSource } from "../gamls";
import { purgeScope } from "../purge";
import type { MapSkipReason, UpdatesPage } from "../types";
import page1 from "./fixtures/bridge-gamls-page1.json";
import page2 from "./fixtures/bridge-gamls-page2.json";
import { EXCLUDED_FIELDS, mapResoProperty, type ResoProperty } from "./mapper";
import {
  missingCredentials,
  MissingCredentialsError,
  ResoWebApiProvider,
  updatesFilter,
} from "./provider";

// Georgia MLS as Bridge Interactive serves it (RESO Web API, OData pages with
// an access_token in @odata.nextLink): fictional records shaped like the feed,
// through the mapper and the provider. What mapper.test.ts and
// provider.test.ts already prove on inline records isn't repeated here.

const rows = (page: { value: unknown[] }) => page.value as ResoProperty[];
const records = [...rows(page1), ...rows(page2)];
const lastOfPage1 = rows(page1).at(-1)!;

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("Bridge fixtures through the mapper", () => {
  const mapped = new Map(records.map((r) => [r.ListingKey!, mapResoProperty(r)]));
  const listing = (key: string) => {
    const r = mapped.get(key)!;
    if (!r.ok) throw new Error(`${key} was skipped: ${r.reason}`);
    return r.listing;
  };

  it("maps or skips each record as expected", () => {
    const expected: Record<string, "ok" | MapSkipReason> = {
      "GA-ADAM-0001": "ok",
      "GA-0002-LAND": "ok",
      "GA-0003-COMM": "ok",
      "GA-0004-FARM": "ok",
      "GA-0005-SOLD": "ok",
      "GA-0006-HIDE": "not_displayable",
      "GA-0007-WDRN": "ok",
      "GA-0008-EXCL": "ok",
    };
    expect(
      Object.fromEntries([...mapped].map(([k, r]) => [k, r.ok ? "ok" : r.reason])),
    ).toEqual(expected);
    expect(listing("GA-0002-LAND").propertyType).toBe("land");
    expect(listing("GA-0004-FARM").propertyType).toBe("farm_ranch");
    expect(listing("GA-0005-SOLD")).toMatchObject({ status: "closed", closePrice: 214500 });
    expect(listing("GA-0007-WDRN").status).toBe("withdrawn");
  });

  it("the firm's listing: office and agent IDs, photos in Order, open house, attribution contact", () => {
    const l = listing("GA-ADAM-0001");
    expect(l.listOfficeMlsId).toBe("ADAM01");
    expect(l.listAgentMlsId).toBe("ANDEREGGAA");
    expect(l.media.map((m) => m.sourceKey)).toEqual([
      "GA-ADAM-0001-M1",
      "GA-ADAM-0001-M2",
      "GA-ADAM-0001-M3",
    ]);
    expect(l.openHouses).toHaveLength(1);
    expect(l.attributionPhone).toBe("(706) 555-0101");
    expect(l.attributionEmail).toBe("listing@example.com");
    expect(l.variableCompensation).toBe(false);
  });

  it("a commercial lease quoted per year becomes a monthly rent", () => {
    expect(listing("GA-0003-COMM")).toMatchObject({ transactionType: "rent", listPrice: 2000 });
  });

  it("never carries a mandatory-exclusion field", () => {
    const record = records.find((r) => r.ListingKey === "GA-0008-EXCL")!;
    for (const field of EXCLUDED_FIELDS) expect(record[field]).toBe(`EXCLUDED-${field}`);
    for (const r of mapped.values()) {
      if (r.ok) expect(JSON.stringify(r.listing)).not.toContain("EXCLUDED-");
    }
  });
});

/**
 * Serves the two fixture pages by keyset: page 1 for the first request, page 2
 * for the records after page 1's last, then an empty page. `throttleFirst`
 * answers the first request 429 with Retry-After: 2.
 */
function bridge(opts: { throttleFirst?: boolean } = {}) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (opts.throttleFirst && requests.length === 1) {
      return new Response("Too many requests", { status: 429, headers: { "Retry-After": "2" } });
    }
    const q = new URL(url).searchParams;
    if (q.has("$select")) return Response.json({ value: [] });
    const filter = q.get("$filter") ?? "";
    if (!filter.includes("ListingKey gt")) return Response.json(page1);
    if (filter.includes(`ListingKey gt '${lastOfPage1.ListingKey}'`)) return Response.json(page2);
    return Response.json({ value: [] });
  }) as unknown as typeof fetch;
  const provider = new ResoWebApiProvider(
    gamlsSource({}).config,
    { MLS_GAMLS_TOKEN: "test-token" },
    {
      fetchImpl,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  return { provider, requests, sleeps };
}

describe("ResoWebApiProvider against Bridge", () => {
  it("pages the feed by keyset with the bearer token, never following @odata.nextLink", async () => {
    const { provider, requests } = bridge();
    const pages = (await collect(provider.fetchUpdates(null))) as UpdatesPage[];
    expect(requests).toHaveLength(3);
    for (const { url, init } of requests) {
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
      expect(headers.Accept).toBe("application/json");
      expect(url.startsWith(`${gamlsBaseUrl({})}/Property?`)).toBe(true);
      const q = new URL(url).searchParams;
      expect(q.get("$expand")).toBe("Media,OpenHouse");
      expect(q.get("$top")).toBe("200");
      expect(q.has("$skip")).toBe(false);
    }
    expect(pages.map((p) => p.items.length)).toEqual([5, 3]);
    expect(pages[0].last).toEqual({
      modifiedAt: new Date(lastOfPage1.ModificationTimestamp as string),
      key: lastOfPage1.ListingKey,
    });
    // Page 2 starts after (timestamp, key): its first record shares page 1's last timestamp.
    const after = updatesFilter({
      timestamp: lastOfPage1.ModificationTimestamp as string,
      key: lastOfPage1.ListingKey!,
    });
    expect(new URL(requests[1].url).searchParams.get("$filter")).toBe(`(${after})`);
  });

  it("downloads the purge keys 200 at a time (Bridge's $top cap)", async () => {
    const { provider, requests } = bridge();
    await collect(provider.fetchActiveKeys(purgeScope(new Date("2026-10-20T12:00:00Z"))));
    const q = new URL(requests[0].url).searchParams;
    expect(q.get("$top")).toBe("200");
    expect(q.get("$select")).toBe("ListingKey");
  });

  it("waits out a 429's Retry-After, then carries on", async () => {
    const { provider, sleeps } = bridge({ throttleFirst: true });
    const pages = await collect(provider.fetchUpdates(null));
    expect(sleeps).toEqual([2000]);
    expect(pages).toHaveLength(2);
  });
});

describe("Georgia MLS credentials", () => {
  const { config } = gamlsSource({});

  it("refuses to build a provider without MLS_GAMLS_TOKEN", () => {
    expect(() => new ResoWebApiProvider(config, {})).toThrow(MissingCredentialsError);
    expect(() => new ResoWebApiProvider(config, {})).toThrow(/MLS_GAMLS_TOKEN/);
  });

  it("treats an empty token as unset", () => {
    expect(missingCredentials(config, { MLS_GAMLS_TOKEN: "t" })).toBeNull();
    expect(missingCredentials(config, { MLS_GAMLS_TOKEN: "" })).toEqual(expect.any(String));
  });
});

describe("gamlsSource", () => {
  it("defines the Georgia MLS feed on Bridge", () => {
    const s = gamlsSource({});
    expect(s).toMatchObject({
      slug: "gamls",
      name: site.mls.name,
      kind: "reso_web_api",
      isActive: true,
      disclaimer: site.mls.disclaimer,
    });
    expect(s.config).toEqual({
      baseUrl: "https://api.bridgedataoutput.com/api/v2/OData/gamls",
      resource: "Property",
      credentialsEnvPrefix: "MLS_GAMLS",
      companyOfficeIds: ["ADAM01"],
      keyPageSize: 200,
    });
  });

  it("takes the dataset name from MLS_GAMLS_DATASET", () => {
    expect(gamlsSource({ MLS_GAMLS_DATASET: "gamls_test" }).config.baseUrl).toBe(
      "https://api.bridgedataoutput.com/api/v2/OData/gamls_test",
    );
  });
});
