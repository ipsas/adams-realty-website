import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { closeDb } from "@/test/db/helpers";
import { emailKey, hitFormLimits, retryPhrase } from "./form-guard";

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
