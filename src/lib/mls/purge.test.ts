import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  inPurgeScope,
  PRUNE_REMOVED_AFTER_DAYS,
  pruneRemovedWhere,
  PURGE_LIVE_STATUSES,
  purgeCap,
  purgeCountQuery,
  purgeOverdue,
  purgeScope,
  purgeWhere,
} from "./purge";
import { mapStatus } from "./reso/mapper";
import { purgeScopeFilter } from "./reso/provider";

const dialect = new PgDialect();
const SOURCE = "b35e5476-2b15-4c16-908b-020063e6a746";
const scope = { closedSince: "2025-09-25" };

describe("purgeWhere", () => {
  it("binds the feed's keys as one array parameter, however many there are", () => {
    const keys = Array.from({ length: 100_000 }, (_, i) => `K${i}`);
    const { sql, params } = dialect.sqlToQuery(purgeWhere(SOURCE, keys, scope));
    expect(params.length).toBeLessThan(20);
    expect(params).toContainEqual(keys);
    expect(sql).toMatch(
      /not exists \(select 1 from unnest\(\$\d+::text\[\]\) as feed\(key\) where feed\.key = "listings"\."listing_key"\)/,
    );
  });

  it("counts with the keys hash-joined, not a per-row subquery", () => {
    const keys = Array.from({ length: 100_000 }, (_, i) => `K${i}`);
    const { sql, params } = dialect.sqlToQuery(purgeCountQuery(SOURCE, keys, scope));
    expect(params.length).toBeLessThan(20);
    expect(sql).toContain(
      `left join unnest($1::text[]) as feed(key) on feed.key = "listings"."listing_key"`,
    );
    expect(sql).not.toMatch(/filter \(where not exists/);
  });

  it("only compares the source's listings the site keeps showing", () => {
    const { sql, params } = dialect.sqlToQuery(purgeWhere(SOURCE, ["K1"], scope));
    expect(sql).toContain(`"listings"."source_id" = $1`);
    expect(sql).toContain(`"listings"."removed_at" is null`);
    // Live statuses, or a sale closed inside the window.
    expect(sql).toMatch(
      /\("listings"\."status" in \(\$2, \$3, \$4, \$5\) or \("listings"\."status" = \$6 and "listings"\."close_date" >= \$7\)\)/,
    );
    expect(params.slice(0, 7)).toEqual([
      SOURCE,
      "active",
      "coming_soon",
      "active_under_contract",
      "pending",
      "closed",
      "2025-09-25",
    ]);
  });
});

describe("live-only scope", () => {
  const liveOnly = { closedSince: "2025-09-25", liveOnly: true };

  it("compares every row of the source not yet removed, whatever its status", () => {
    const { sql, params } = dialect.sqlToQuery(inPurgeScope(SOURCE, liveOnly));
    expect(sql).toBe(`("listings"."source_id" = $1 and "listings"."removed_at" is null)`);
    expect(params).toEqual([SOURCE]);
  });

  it("purgeWhere and purgeCountQuery drop the status and close-date condition", () => {
    for (const statement of [
      purgeWhere(SOURCE, ["K1"], liveOnly),
      purgeCountQuery(SOURCE, ["K1"], liveOnly),
    ]) {
      const { sql } = dialect.sqlToQuery(statement);
      expect(sql).toContain(`"listings"."removed_at" is null`);
      expect(sql).not.toContain(`"listings"."status"`);
      expect(sql).not.toContain(`"listings"."close_date"`);
    }
  });

  it("without liveOnly they keep it", () => {
    for (const statement of [
      inPurgeScope(SOURCE, scope),
      purgeWhere(SOURCE, ["K1"], scope),
      purgeCountQuery(SOURCE, ["K1"], scope),
    ]) {
      const { sql } = dialect.sqlToQuery(statement);
      expect(sql).toContain(`"listings"."status" in`);
      expect(sql).toContain(`"listings"."close_date" >=`);
    }
  });
});

describe("pruneRemovedWhere", () => {
  it("takes the source's rows removed before the cutoff that no lead or saved home references", () => {
    const before = new Date("2026-09-18T09:00:00Z");
    const { sql, params } = dialect.sqlToQuery(pruneRemovedWhere(SOURCE, before));
    expect(sql).toContain(`"listings"."source_id" = $1`);
    expect(sql).toContain(`"listings"."removed_at" < $2`);
    expect(sql).toContain(
      `not exists (select 1 from "inquiries" where "inquiries"."listing_id" = "listings"."id")`,
    );
    expect(sql).toContain(
      `not exists (select 1 from "saved_listings" where "saved_listings"."listing_id" = "listings"."id")`,
    );
    expect(params[0]).toBe(SOURCE);
    expect(params).toHaveLength(2);
  });

  it("waits a week", () => {
    expect(PRUNE_REMOVED_AFTER_DAYS).toBe(7);
  });
});

describe("purgeScope / purgeCap", () => {
  it("keeps a year of closed sales (sold mode's default window)", () => {
    expect(purgeScope(new Date("2026-09-25T09:00:00Z"))).toEqual({ closedSince: "2025-09-25" });
  });

  it("marks a live-only scope", () => {
    expect(purgeScope(new Date("2026-09-25T09:00:00Z"), { liveOnly: true })).toEqual({
      closedSince: "2025-09-25",
      liveOnly: true,
    });
    expect(purgeScope(new Date("2026-09-25T09:00:00Z"), { liveOnly: false }).liveOnly).toBe(
      undefined,
    );
  });

  it("caps removals at 5%, but never below 25", () => {
    expect(purgeCap(53_000)).toBe(2_650);
    expect(purgeCap(1_000)).toBe(50);
    expect(purgeCap(100)).toBe(25);
    expect(purgeCap(0)).toBe(25);
  });
});

describe("purgeScopeFilter (RESO)", () => {
  it("asks the feed for the same scope, in the StandardStatus spelling the mapper reads", () => {
    expect(purgeScopeFilter(scope)).toBe(
      "StandardStatus eq 'Active' or StandardStatus eq 'Active Under Contract' or " +
        "StandardStatus eq 'Coming Soon' or StandardStatus eq 'Pending' or " +
        "(StandardStatus eq 'Closed' and CloseDate ge 2025-09-25)",
    );
  });

  it("names exactly the statuses the database side keeps", () => {
    const named = [...purgeScopeFilter(scope).matchAll(/StandardStatus eq '([^']+)'/g)].map((m) =>
      mapStatus(m[1]),
    );
    expect(named).toHaveLength(5);
    expect(new Set(named)).toEqual(new Set([...PURGE_LIVE_STATUSES, "closed"]));
  });

  it("rejects a date that isn't YYYY-MM-DD (it goes into the URL unquoted)", () => {
    expect(() => purgeScopeFilter({ closedSince: "2025-09-25' or 1 eq 1" })).toThrow();
  });
});

describe("purgeOverdue", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it("is fine within a day and a half of the last successful purge", () => {
    expect(purgeOverdue({ firstRunAt: hoursAgo(900), lastPurgeAt: hoursAgo(35) }, now)).toBe(false);
  });

  it("warns once a purge has been missing longer than that", () => {
    expect(purgeOverdue({ firstRunAt: hoursAgo(900), lastPurgeAt: hoursAgo(37) }, now)).toBe(true);
  });

  it("counts from the first run for a feed that has never purged", () => {
    expect(purgeOverdue({ firstRunAt: hoursAgo(2), lastPurgeAt: null }, now)).toBe(false);
    expect(purgeOverdue({ firstRunAt: hoursAgo(40), lastPurgeAt: null }, now)).toBe(true);
  });

  it("says nothing for a feed that has never run", () => {
    expect(purgeOverdue({ firstRunAt: null, lastPurgeAt: null }, now)).toBe(false);
  });
});
