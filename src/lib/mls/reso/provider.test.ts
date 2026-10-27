import { describe, expect, it } from "vitest";
import type { DataSourceConfig } from "@/db/schema";
import { gamlsFilter, liveStatusFilter, ownOfficeIds } from "../gamls";
import { purgeScope } from "../purge";
import type { UpdatesPage } from "../types";
import {
  MissingCredentialsError,
  ownClosedFilter,
  purgeScopeFilter,
  ResoWebApiProvider,
  UnexpectedResponseError,
  updatesFilter,
  type ResoProviderOptions,
} from "./provider";

// The provider against a fake RESO server that honors the keyset filters it
// sends and, like many real ones, offers a `$skip`-based @odata.nextLink.

type Row = { ListingKey: string; ModificationTimestamp: string; [k: string]: unknown };

const unquote = (s: string) => s.replace(/''/g, "'");

/** Serves `rows()` as OData, reading only the parts of $filter the provider writes. */
function fakeServer(
  rows: () => Row[],
  onRequest: (n: number) => void = () => {},
  config: DataSourceConfig = {
    baseUrl: "https://feed.example.com/odata",
    filter: "OriginatingSystemName eq 'GAMLS'",
  },
  options: Omit<ResoProviderOptions, "fetchImpl"> = {},
) {
  const urls: URL[] = [];
  const fetchImpl = (async (input: string) => {
    const url = new URL(input);
    urls.push(url);
    onRequest(urls.length);
    const q = url.searchParams;
    const filter = q.get("$filter") ?? "";
    const top = Number(q.get("$top"));
    let out = [...rows()];
    const keyAfter = filter.match(/ListingKey gt '((?:[^']|'')*)'\)$/);
    const since = filter.match(/ModificationTimestamp ge (\S+?)\)*$/);
    const after = filter.match(
      /ModificationTimestamp gt (\S+) or \(ModificationTimestamp eq \S+ and ListingKey gt '((?:[^']|'')*)'\)/,
    );
    if (q.get("$orderby") === "ListingKey asc") {
      out.sort((a, b) => (a.ListingKey < b.ListingKey ? -1 : 1));
      if (keyAfter) out = out.filter((r) => r.ListingKey > unquote(keyAfter[1]));
    } else {
      out.sort(
        (a, b) =>
          Date.parse(a.ModificationTimestamp) - Date.parse(b.ModificationTimestamp) ||
          (a.ListingKey < b.ListingKey ? -1 : 1),
      );
      if (after) {
        const t = Date.parse(after[1]);
        const k = unquote(after[2]);
        out = out.filter((r) => {
          const m = Date.parse(r.ModificationTimestamp);
          return m > t || (m === t && r.ListingKey > k);
        });
      } else if (since) {
        out = out.filter((r) => Date.parse(r.ModificationTimestamp) >= Date.parse(since[1]));
      }
    }
    const skip = Number(q.get("$skip") ?? 0);
    const page = out.slice(skip, skip + top);
    const next = new URL(url);
    next.searchParams.set("$skip", String(skip + top));
    return Response.json({ value: page, "@odata.nextLink": next.toString() });
  }) as unknown as typeof fetch;
  const provider = new ResoWebApiProvider(config, { MLS_TOKEN: "t" }, { ...options, fetchImpl });
  return { provider, urls };
}

const ts = (s: number) => new Date(Date.UTC(2026, 8, 25, 9, 0, s)).toISOString();

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("ResoWebApiProvider credentials", () => {
  it("throws MissingCredentialsError, naming the variable, when the env has none", () => {
    const build = () =>
      new ResoWebApiProvider(
        { baseUrl: "https://feed.example.com/odata", credentialsEnvPrefix: "MLS_X" },
        { MLS_X_TOKEN: "" },
      );
    expect(build).toThrow(MissingCredentialsError);
    expect(build).toThrow(/MLS_X_TOKEN is not set/);
  });
});

describe("ResoWebApiProvider.fetchActiveKeys", () => {
  it("misses no key when a listing leaves the feed during the download", async () => {
    let rows: Row[] = Array.from({ length: 2500 }, (_, i) => ({
      ListingKey: `K${String(i).padStart(5, "0")}`,
      ModificationTimestamp: ts(0),
    }));
    // After the first page, an early listing closes and leaves the scope: with
    // $skip paging every later key would shift one place and K01000 be skipped.
    const { provider, urls } = fakeServer(
      () => rows,
      (n) => {
        if (n === 2) rows = rows.filter((r) => r.ListingKey !== "K00010");
      },
    );
    const keys = (await collect(provider.fetchActiveKeys(purgeScope(new Date(ts(0)))))).flat();
    expect(keys).toContain("K01000");
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(2500);
    // Keyset pages, ending at the first empty one; never $skip.
    expect(urls).toHaveLength(4);
    expect(urls.every((u) => !u.searchParams.has("$skip"))).toBe(true);
    expect(urls[1].searchParams.get("$filter")).toBe(
      `(OriginatingSystemName eq 'GAMLS') and (${purgeScopeFilter(purgeScope(new Date(ts(0))))}) and (ListingKey gt 'K00999')`,
    );
  });

  it("with a live-only scope asks for the base filter and the live statuses only", async () => {
    const rows = [{ ListingKey: "A-1", ModificationTimestamp: ts(0) }];
    const { provider, urls } = fakeServer(() => rows);
    const scope = purgeScope(new Date(ts(0)), { liveOnly: true });
    await collect(provider.fetchActiveKeys(scope));
    expect(urls[0].searchParams.get("$filter")).toBe(
      `(OriginatingSystemName eq 'GAMLS') and (${liveStatusFilter()})`,
    );
    expect(urls[0].searchParams.get("$filter")).not.toContain("Closed");
  });

  it("quotes keys that contain an apostrophe", async () => {
    const rows = [
      { ListingKey: "A-1", ModificationTimestamp: ts(0) },
      { ListingKey: "O'NEAL-2", ModificationTimestamp: ts(0) },
    ];
    const { provider, urls } = fakeServer(() => rows);
    const keys = (await collect(provider.fetchActiveKeys(purgeScope(new Date(ts(0)))))).flat();
    expect(keys).toEqual(["A-1", "O'NEAL-2"]);
    // The request after the page ending at O'NEAL-2 (the empty one that ends the list).
    expect(urls[1].searchParams.get("$filter")).toMatch(/and \(ListingKey gt 'O''NEAL-2'\)$/);
  });
});

describe("purgeScopeFilter", () => {
  it("with liveOnly returns only the live clause", () => {
    expect(purgeScopeFilter({ closedSince: "2025-09-25", liveOnly: true })).toBe(
      liveStatusFilter(),
    );
  });

  it("without it keeps the closed-sales window", () => {
    expect(purgeScopeFilter({ closedSince: "2025-09-25" })).toBe(
      `${liveStatusFilter()} or (StandardStatus eq 'Closed' and CloseDate ge 2025-09-25)`,
    );
  });
});

describe("ResoWebApiProvider.fetchUpdates", () => {
  it("pages by (timestamp, key): records sharing a timestamp across a page break are each read once", async () => {
    // 450 records, 300 of them stamped the same second.
    const rows: Row[] = Array.from({ length: 450 }, (_, i) => ({
      ListingKey: `K${String(i).padStart(5, "0")}`,
      ModificationTimestamp: i < 300 ? ts(1) : ts(2 + i),
      StandardStatus: "Active",
    }));
    const { provider, urls } = fakeServer(() => rows);
    const pages = (await collect(provider.fetchUpdates(null))) as UpdatesPage[];
    const keys = pages.flatMap((p) =>
      p.items.map((r) => (r.ok ? r.listing.listingKey : r.listingKey)),
    );
    expect(keys).toHaveLength(450);
    expect(new Set(keys).size).toBe(450);
    expect(pages[0].last).toEqual({ modifiedAt: new Date(ts(1)), key: "K00199" });
    expect(urls[1].searchParams.get("$filter")).toBe(
      `(OriginatingSystemName eq 'GAMLS') and (${updatesFilter({ timestamp: ts(1), key: "K00199" })})`,
    );
    expect(urls[1].searchParams.get("$orderby")).toBe("ModificationTimestamp asc,ListingKey asc");
    expect(urls.every((u) => !u.searchParams.has("$skip"))).toBe(true);
  });

  it("starts at or after a timestamp, or strictly after a position", async () => {
    const rows: Row[] = [
      { ListingKey: "A", ModificationTimestamp: ts(5) },
      { ListingKey: "B", ModificationTimestamp: ts(5) },
      { ListingKey: "C", ModificationTimestamp: ts(6) },
    ];
    const keysFrom = async (from: Parameters<ResoWebApiProvider["fetchUpdates"]>[0]) => {
      const { provider } = fakeServer(() => rows);
      const pages = await collect(provider.fetchUpdates(from));
      return pages.flatMap((p) => p.items.map((r) => (r.ok ? r.listing.listingKey : r.listingKey)));
    };
    expect(await keysFrom({ modifiedAt: new Date(ts(5)), key: null })).toEqual(["A", "B", "C"]);
    expect(await keysFrom({ modifiedAt: new Date(ts(5)), key: "A" })).toEqual(["B", "C"]);
  });

  it("keeps a feed's sub-millisecond timestamps verbatim between pages", async () => {
    expect(updatesFilter({ timestamp: "2026-09-25T09:00:00.1234567Z", key: "K1" })).toBe(
      "ModificationTimestamp gt 2026-09-25T09:00:00.1234567Z or " +
        "(ModificationTimestamp eq 2026-09-25T09:00:00.1234567Z and ListingKey gt 'K1')",
    );
    expect(() => updatesFilter({ timestamp: "2026-09-25 or 1 eq 1", key: null })).toThrow();
  });
});

describe("ownClosedFilter", () => {
  it("asks for the list office's closed sales since the date, nothing else", () => {
    expect(ownClosedFilter(["ADAM01"], "2025-10-26")).toBe(
      "(ListOfficeMlsId eq 'ADAM01') and StandardStatus eq 'Closed' and CloseDate ge 2025-10-26",
    );
    expect(ownClosedFilter(["ADAM01", "ADAM02"], "2025-10-26")).toBe(
      "(ListOfficeMlsId eq 'ADAM01' or ListOfficeMlsId eq 'ADAM02') and " +
        "StandardStatus eq 'Closed' and CloseDate ge 2025-10-26",
    );
    expect(ownClosedFilter(["O'B"], "2025-10-26")).toMatch(/^\(ListOfficeMlsId eq 'O''B'\)/);
  });

  it("rejects anything but a YYYY-MM-DD date, and no office IDs", () => {
    expect(() => ownClosedFilter(["ADAM01"], "2025-10-26 or 1 eq 1")).toThrow(/YYYY-MM-DD/);
    expect(() => ownClosedFilter(["ADAM01"], "2025-10-26T00:00:00Z")).toThrow(/YYYY-MM-DD/);
    expect(() => ownClosedFilter(["ADAM01"], "")).toThrow(/YYYY-MM-DD/);
    expect(() => ownClosedFilter([], "2025-10-26")).toThrow(/no office IDs/);
  });
});

describe("ResoWebApiProvider.ownClosed", () => {
  // The Georgia MLS row as add-gamls-source writes it, statewide with no office ID.
  const gamlsConfig: DataSourceConfig = {
    baseUrl: "https://feed.example.com/odata",
    filter: gamlsFilter({}),
    liveOnly: true,
    companyOfficeIds: ["ADAM01"],
    keyPageSize: 2,
    expand: "",
  };
  const own =
    "(ListOfficeMlsId eq 'ADAM01') and StandardStatus eq 'Closed' and CloseDate ge 2025-10-26";
  const rows: Row[] = ["K3", "K1", "K2"].map((k) => ({
    ListingKey: k,
    ModificationTimestamp: ts(0),
  }));

  it("fetchKeys pages by key with the own-closed filter alone, never the saved live filter", async () => {
    const { provider, urls } = fakeServer(() => rows, undefined, gamlsConfig);
    const keys = (await collect(provider.ownClosed!.fetchKeys("2025-10-26"))).flat();
    expect(keys).toEqual(["K1", "K2", "K3"]);
    expect(urls.map((u) => u.searchParams.get("$filter"))).toEqual([
      own,
      `(${own}) and (ListingKey gt 'K2')`,
      `(${own}) and (ListingKey gt 'K3')`,
    ]);
    expect(urls[0].searchParams.get("$select")).toBe("ListingKey");
    expect(urls[0].searchParams.get("$top")).toBe("2");
    expect(urls[0].searchParams.get("$orderby")).toBe("ListingKey asc");
    expect(urls.every((u) => !u.searchParams.has("$skip"))).toBe(true);
  });

  it("fetchUpdates reads the full records by key, mapped like the main feed", async () => {
    const { provider, urls } = fakeServer(() => rows, undefined, gamlsConfig);
    const pages = await collect(provider.ownClosed!.fetchUpdates("2025-10-26"));
    const keys = pages.flatMap((p) =>
      p.items.map((r) => (r.ok ? r.listing.listingKey : r.listingKey)),
    );
    expect(keys).toEqual(["K1", "K2", "K3"]);
    expect(urls[0].searchParams.get("$filter")).toBe(own);
    expect(urls[0].searchParams.get("$orderby")).toBe("ListingKey asc");
    expect(urls[0].searchParams.has("$select")).toBe(false);
    expect(urls[0].searchParams.has("$expand")).toBe(false);
    expect(urls[1].searchParams.get("$filter")).toBe(`(${own}) and (ListingKey gt 'K3')`);
  });

  it("validates the date before asking the feed", async () => {
    const { provider, urls } = fakeServer(() => rows, undefined, gamlsConfig);
    await expect(collect(provider.ownClosed!.fetchKeys("2025-10-26 or 1 eq 1"))).rejects.toThrow(
      /YYYY-MM-DD/,
    );
    expect(urls).toHaveLength(0);
  });

  it("uses the injected office IDs over the config's", async () => {
    const { provider, urls } = fakeServer(() => rows, undefined, gamlsConfig, {
      ownOfficeIds: ["ADAM01", "ADAM02"],
    });
    await collect(provider.ownClosed!.fetchKeys("2025-10-26"));
    expect(urls[0].searchParams.get("$filter")).toBe(
      ownClosedFilter(["ADAM01", "ADAM02"], "2025-10-26"),
    );
  });

  it("is null for a feed that isn't live-only, or without office IDs", () => {
    expect(
      fakeServer(() => rows, undefined, { ...gamlsConfig, liveOnly: false }).provider.ownClosed,
    ).toBeNull();
    expect(
      fakeServer(() => rows, undefined, { ...gamlsConfig, companyOfficeIds: [] }).provider
        .ownClosed,
    ).toBeNull();
    expect(
      fakeServer(() => rows, undefined, { ...gamlsConfig, companyOfficeIds: undefined }).provider
        .ownClosed,
    ).toBeNull();
    expect(
      fakeServer(() => rows, undefined, gamlsConfig, { ownOfficeIds: [] }).provider.ownClosed,
    ).toBeNull();
  });
});

describe("ownOfficeIds", () => {
  it("is the stored companyOfficeIds, else the firm's office for the Georgia MLS source only", () => {
    expect(ownOfficeIds({ slug: "gamls", config: { companyOfficeIds: ["X1"] } })).toEqual(["X1"]);
    expect(ownOfficeIds({ slug: "gamls", config: {} })).toEqual(["ADAM01"]);
    expect(ownOfficeIds({ slug: "gamls", config: { companyOfficeIds: [] } })).toEqual(["ADAM01"]);
    expect(ownOfficeIds({ slug: "actris", config: {} })).toEqual([]);
  });
});

describe("ResoWebApiProvider.fetchOffices", () => {
  function officeFeed(respond: () => Response) {
    const urls: URL[] = [];
    const fetchImpl = (async (input: string) => {
      urls.push(new URL(input));
      return respond();
    }) as unknown as typeof fetch;
    const provider = new ResoWebApiProvider(
      { baseUrl: "https://api.bridgedataoutput.com/api/v2/OData/gamls2" },
      { MLS_TOKEN: "t" },
      { fetchImpl, sleep: async () => {} },
    );
    return { provider, urls };
  }

  it("asks the Office resource for the IDs and returns trimmed names", async () => {
    const { provider, urls } = officeFeed(() =>
      Response.json({
        value: [
          { OfficeMlsId: "RMCR", OfficeName: " Re/Max Center " },
          { OfficeMlsId: "BLNK", OfficeName: "  " },
          { OfficeMlsId: "", OfficeName: "No id" },
        ],
      }),
    );
    expect(await provider.fetchOffices(["RMCR", "O'NE", "BLNK"])).toEqual([
      { officeMlsId: "RMCR", officeName: "Re/Max Center" },
      { officeMlsId: "BLNK", officeName: null },
    ]);
    const [url] = urls;
    expect(url.pathname).toMatch(/\/Office$/);
    expect(url.searchParams.get("$filter")).toBe(
      "OfficeMlsId eq 'RMCR' or OfficeMlsId eq 'O''NE' or OfficeMlsId eq 'BLNK'",
    );
    expect(url.searchParams.get("$select")).toBe("OfficeMlsId,OfficeName");
    expect(url.searchParams.get("$top")).toBe("3");
  });

  it("returns the Bridge body's office", async () => {
    const { provider } = officeFeed(() =>
      Response.json({ value: [{ OfficeMlsId: "RMCR", OfficeName: "Re/Max Center" }] }),
    );
    expect(await provider.fetchOffices(["RMCR"])).toEqual([
      { officeMlsId: "RMCR", officeName: "Re/Max Center" },
    ]);
  });

  it("surfaces an HTTP status without retrying", async () => {
    for (const status of [401, 503]) {
      const { provider, urls } = officeFeed(() => new Response("nope", { status }));
      await expect(provider.fetchOffices(["RMCR"])).rejects.toMatchObject({ status });
      expect(urls).toHaveLength(1);
    }
  });

  it("throws on a body without a value array", async () => {
    const { provider, urls } = officeFeed(() => Response.json({ error: "bad" }));
    await expect(provider.fetchOffices(["RMCR"])).rejects.toThrow(UnexpectedResponseError);
    expect(urls).toHaveLength(1);
  });
});
