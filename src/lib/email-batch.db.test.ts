import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { appFlags, emailSendCounters, savedSearches, users } from "@/db/schema";
import { parseSearchParams } from "@/lib/search/params";
import { closeDb } from "@/test/db/helpers";
import {
  activateEmailAlerts,
  countSent,
  DAILY_TOTAL_CAP,
  MONTHLY_TOTAL_CAP,
  sendCounter,
} from "./email-batch";

// The send counter and the one-time activation against Postgres: the UTC day
// comes from the database clock, the caps hold under concurrency, and refunds
// go to the day they were charged to.

const USER = "email-batch-user";
const DAY = 86_400_000;

const today = async () =>
  (
    await db.execute<{ day: string }>(
      sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as day`,
    )
  ).rows[0].day;
const row = async (period: string) =>
  (await db.select().from(emailSendCounters).where(eq(emailSendCounters.period, period)))[0];

beforeEach(async () => {
  await db.execute(sql`truncate table email_send_counters, app_flags`);
});

afterAll(async () => {
  await db.execute(sql`truncate table email_send_counters, app_flags`);
  await db.delete(users).where(eq(users.id, USER));
  await closeDb();
});

describe("sendCounter", () => {
  it("charges today's UTC row until the batch budget, and returns the period", async () => {
    const counter = sendCounter(db);
    const day = await today();
    for (let i = 0; i < 3; i++) expect(await counter.reserve(3)).toBe(day);
    expect(await counter.reserve(3)).toBeNull();
    expect(await row(day)).toMatchObject({ batch: 3, total: 3 });
  });

  it("never lets parallel reserves pass the budget", async () => {
    const counter = sendCounter(db);
    const results = await Promise.all(Array.from({ length: 100 }, () => counter.reserve(60)));
    expect(results.filter(Boolean)).toHaveLength(60);
    expect(await row(await today())).toMatchObject({ batch: 60, total: 60 });
  });

  it("refuses batch mail once all sends today reach the daily total", async () => {
    const counter = sendCounter(db);
    await countSent(DAILY_TOTAL_CAP - 1, db);
    expect(await counter.reserve(60)).not.toBeNull();
    expect(await counter.reserve(60)).toBeNull();
    expect(await row(await today())).toMatchObject({ batch: 1, total: DAILY_TOTAL_CAP });
  });

  it("refuses batch mail once this UTC month reaches the monthly total, even on a new day", async () => {
    const day = await today();
    const month = day.slice(0, 7);
    // Earlier this month (or a fake day 00 when today is the 1st: same month prefix).
    const earlier = day.endsWith("-01") ? `${month}-00` : `${month}-01`;
    await db.insert(emailSendCounters).values({ period: earlier, total: MONTHLY_TOTAL_CAP });
    expect(await sendCounter(db).reserve(60)).toBeNull();
    expect(await row(day)).toBeUndefined();
    // Last month's sends don't count.
    await db.update(emailSendCounters).set({ period: "2000-01-01" });
    expect(await sendCounter(db).reserve(60)).toBe(day);
  });

  it("refunds on the given period only, floored at 0", async () => {
    const counter = sendCounter(db);
    const day = await today();
    await db.insert(emailSendCounters).values({ period: "2000-01-01", batch: 5, total: 5 });
    await counter.reserve(60);
    await counter.refund(day);
    await counter.refund(day);
    expect(await row(day)).toMatchObject({ batch: 0, total: 0 });
    expect(await row("2000-01-01")).toMatchObject({ batch: 5, total: 5 });
  });

  it("counts transactional sends in the total only", async () => {
    await countSent(1, db);
    await countSent(2, db);
    expect(await row(await today())).toMatchObject({ batch: 0, total: 3 });
  });
});

describe("activateEmailAlerts", () => {
  it("marks changes older than 24 hours as seen, once", async () => {
    await db.delete(users).where(eq(users.id, USER));
    await db.insert(users).values({ id: USER, name: "Pat Buyer", email: "pat@example.com" });
    const old = new Date(Date.now() - 10 * DAY);
    const recent = new Date(Date.now() - 3_600_000);
    const criteria = parseSearchParams({});
    const [stale, fresh] = await db
      .insert(savedSearches)
      .values([
        { userId: USER, name: "Stale", criteria, createdAt: old, lastAlertedAt: old },
        { userId: USER, name: "Fresh", criteria, createdAt: old, lastAlertedAt: recent },
      ])
      .returning({ id: savedSearches.id });
    const lastAlerted = async (id: string) =>
      (await db.select().from(savedSearches).where(eq(savedSearches.id, id)))[0].lastAlertedAt!;

    const results = await Promise.all([activateEmailAlerts(db), activateEmailAlerts(db)]);
    expect(results.sort()).toEqual([false, true]);
    const moved = await lastAlerted(stale.id);
    expect(Math.abs(moved.getTime() - (Date.now() - DAY))).toBeLessThan(60_000);
    expect(await lastAlerted(fresh.id)).toEqual(recent);
    expect(await db.select().from(appFlags)).toHaveLength(1);

    // A second activation changes nothing.
    await db
      .update(savedSearches)
      .set({ lastAlertedAt: old })
      .where(eq(savedSearches.id, stale.id));
    expect(await activateEmailAlerts(db)).toBe(false);
    expect(await lastAlerted(stale.id)).toEqual(old);
  });
});
