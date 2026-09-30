import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { closeDb } from "@/test/db/helpers";
import { hitRateLimits, pruneRateLimits, type LimitWindow } from "./rate-limit-db";

// The anti-scraping limiter's counters live in Postgres, so every serverless
// instance shares them. These run the real statement.

const MINUTE: LimitWindow = { name: "t:1m", limit: 3, ms: 60_000 };
const HOUR: LimitWindow = { name: "t:1h", limit: 5, ms: 3_600_000 };
const t0 = new Date("2026-09-28T15:00:10Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

beforeEach(async () => {
  await db.execute(sql`truncate table rate_limits`);
});
afterAll(closeDb);

describe("hitRateLimits", () => {
  it("allows the limit, then refuses with the time left in the window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++)
      results.push(await hitRateLimits(db, "203.0.113.1", [MINUTE], at(i)));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ ok: false, retryAfter: 50, exceeded: "t:1m" });
  });

  it("starts a fresh count in the next window", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimits(db, "203.0.113.2", [MINUTE], at(i));
    expect((await hitRateLimits(db, "203.0.113.2", [MINUTE], at(60_000))).ok).toBe(true);
  });

  it("counts each client separately", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimits(db, "203.0.113.3", [MINUTE], at(i));
    expect((await hitRateLimits(db, "203.0.113.4", [MINUTE], at(5))).ok).toBe(true);
    expect((await hitRateLimits(db, "203.0.113.3", [MINUTE], at(6))).ok).toBe(false);
  });

  it("enforces every window at once: a slow, steady client hits the hourly cap", async () => {
    const results = [];
    // Two a minute never trips the minute window, but the hour allows five.
    for (let i = 0; i < 6; i++) {
      results.push(await hitRateLimits(db, "203.0.113.5", [MINUTE, HOUR], at(i * 30_000)));
    }
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true, false]);
    expect(results[5].exceeded).toBe("t:1h");
  });

  it("charges each request its units: a heavy request uses up the window faster than a light one", async () => {
    const WEIGHTED: LimitWindow = { name: "t:w", limit: 8, ms: 60_000 };
    // Two page loads at 4 units fill the window; a third is over.
    const pages = [];
    for (let i = 0; i < 3; i++)
      pages.push(await hitRateLimits(db, "203.0.113.7", [WEIGHTED], at(i), 4));
    expect(pages.map((r) => r.ok)).toEqual([true, true, false]);
    // Eight light refreshes at 1 unit fit in the same window.
    const refreshes = [];
    for (let i = 0; i < 9; i++)
      refreshes.push(await hitRateLimits(db, "203.0.113.8", [WEIGHTED], at(i), 1));
    expect(refreshes.filter((r) => r.ok)).toHaveLength(8);
    // A new window starts from the request's own units, not from 1.
    const [row] = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(sql`${rateLimits.key} = 't:w:203.0.113.7'`);
    expect(row.count).toBe(12);
    await hitRateLimits(db, "203.0.113.7", [WEIGHTED], at(60_000), 4);
    const [fresh] = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(sql`${rateLimits.key} = 't:w:203.0.113.7'`);
    expect(fresh.count).toBe(4);
  });

  it("holds up under concurrent requests (one statement, no lost updates)", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => hitRateLimits(db, "203.0.113.6", [MINUTE], at(1))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
});

describe("pruneRateLimits", () => {
  it("drops counters older than two days and keeps recent ones", async () => {
    await hitRateLimits(db, "old", [MINUTE], at(-3 * 86_400_000));
    await hitRateLimits(db, "new", [MINUTE], at(0));
    expect(await pruneRateLimits(db, at(1))).toBe(1);
    const keys = (await db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key);
    expect(keys).toEqual(["t:1m:new"]);
  });
});
