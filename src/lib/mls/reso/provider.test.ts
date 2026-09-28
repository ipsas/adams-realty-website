import { describe, expect, it } from "vitest";
import { purgeScope } from "../purge";
import type { UpdatesPage } from "../types";
import { purgeScopeFilter, ResoWebApiProvider, updatesFilter } from "./provider";

// The provider against a fake RESO server that honors the keyset filters it
// sends and, like many real ones, offers a `$skip`-based @odata.nextLink.

type Row = { ListingKey: string; ModificationTimestamp: string; [k: string]: unknown };

const unquote = (s: string) => s.replace(/''/g, "'");

/** Serves `rows()` as OData, reading only the parts of $filter the provider writes. */
function fakeServer(rows: () => Row[], onRequest: (n: number) => void = () => {}) {
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
  const provider = new ResoWebApiProvider(
    { baseUrl: "https://feed.example.com/odata", filter: "OriginatingSystemName eq 'GAMLS'" },
    { MLS_TOKEN: "t" },
    { fetchImpl },
  );
  return { provider, urls };
}

const ts = (s: number) => new Date(Date.UTC(2026, 8, 25, 9, 0, s)).toISOString();

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

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
