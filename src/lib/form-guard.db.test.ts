import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { closeDb } from "@/test/db/helpers";
import { FORM_TOKEN_MAX_LEADS } from "./form-token";
import { countLeadToken, emailKey, hitFormLimits, retryPhrase } from "./form-guard";

beforeEach(async () => {
  await db.execute(sql`truncate table rate_limits`);
});
afterAll(closeDb);

const prod = { production: true };

describe("hitFormLimits", () => {
  it("limits saved searches per account, whatever the address", async () => {
    const results = [];
    for (let i = 0; i < 21; i++) {
      results.push(
        await hitFormLimits(db, "saved-search", { ip: `198.51.100.${i + 1}`, userId: "u1" }, prod),
      );
    }
    expect(results.slice(0, 20).every((r) => r.ok)).toBe(true);
    expect(results[20]).toMatchObject({ ok: false, exceeded: "saved-search-user:1h" });
    // Another account is unaffected.
    expect((await hitFormLimits(db, "saved-search", { ip: null, userId: "u2" }, prod)).ok).toBe(
      true,
    );
  });

  it("counts the loopback address in production only", async () => {
    for (let i = 0; i < 6; i++)
      await hitFormLimits(db, "inquiry", { ip: "::1" }, { production: false });
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from rate_limits`,
    );
    expect(rows[0].n).toBe(0);
    const results = [];
    for (let i = 0; i < 6; i++)
      results.push(await hitFormLimits(db, "inquiry", { ip: "::1" }, prod));
    expect(results.at(-1)?.ok).toBe(false);
  });

  it("counts an IPv6 sender by its /64, so new addresses in it start no fresh allowance", async () => {
    // Five messages from five addresses in one /64, with five emails: the per-address
    // limit (5 in ten minutes) is used up, and a sixth address in the /64 is refused.
    for (let i = 1; i <= 5; i++) {
      const r = await hitFormLimits(
        db,
        "inquiry",
        { ip: `2001:db8:77::${i}`, email: `a${i}@example.com` },
        prod,
      );
      expect(r.ok, String(i)).toBe(true);
    }
    const sixth = await hitFormLimits(
      db,
      "inquiry",
      { ip: "2001:db8:77::abcd", email: "a6@example.com" },
      prod,
    );
    expect(sixth).toMatchObject({ ok: false, exceeded: "inquiry-ip:10m" });
    // Another /64 in the same /48 has its own ten minutes, but shares the day (30 a day).
    expect(
      (await hitFormLimits(db, "inquiry", { ip: "2001:db8:77:1::1", email: "b@example.com" }, prod))
        .ok,
    ).toBe(true);
    const { rows } = await db.execute<{ key: string }>(
      sql`select key from rate_limits where key like 'inquiry-ip:%' order by key`,
    );
    expect(rows.map((r) => r.key)).toEqual([
      "inquiry-ip:10m:2001:db8:77:0::/64",
      "inquiry-ip:10m:2001:db8:77:1::/64",
      "inquiry-ip:1d:2001:db8:77::/48",
    ]);
    for (let i = 0; i < 24; i++)
      await hitFormLimits(
        db,
        "inquiry",
        { ip: `2001:db8:77:${100 + i}::1`, email: `c${i}@example.com` },
        prod,
      );
    const pastDay = await hitFormLimits(
      db,
      "inquiry",
      { ip: "2001:db8:77:ffff::1", email: "d@example.com" },
      prod,
    );
    expect(pastDay).toMatchObject({ ok: false, exceeded: "inquiry-ip:1d" });
    // Another /48 is someone else.
    expect(
      (await hitFormLimits(db, "inquiry", { ip: "2001:db8:78::1", email: "e@example.com" }, prod))
        .ok,
    ).toBe(true);
  });

  it("lets one form token carry a few leads, not every lead a script sends", async () => {
    for (let i = 0; i < FORM_TOKEN_MAX_LEADS; i++)
      expect(await countLeadToken(db, "tok-a")).toBe(true);
    expect(await countLeadToken(db, "tok-a")).toBe(false);
    expect(await countLeadToken(db, "tok-b")).toBe(true);
  });

  it("hashes emails, case-insensitively", () => {
    expect(emailKey(" Me@Example.com ")).toBe(emailKey("me@example.com"));
    expect(emailKey("me@example.com")).toMatch(/^[0-9a-f]{32}$/);
    expect(emailKey("me@example.com")).not.toBe(emailKey("you@example.com"));
  });

  it("says how long to wait in words", () => {
    expect(retryPhrase(120)).toBe("a few minutes");
    expect(retryPhrase(40 * 60)).toBe("about 40 minutes");
    expect(retryPhrase(5 * 3600)).toBe("about 5 hours");
  });
});
