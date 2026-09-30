import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { rateLimits, sessions, users } from "@/db/schema";
import { closeDb } from "@/test/db/helpers";
import { proxyUser, sessionTokenFromCookie } from "./proxy-session";
import { checkSignUp, SIGN_UP_ELAPSED_HEADER, SIGN_UP_HONEYPOT_HEADER } from "./sign-up-guard";

beforeEach(async () => {
  await db.execute(sql`truncate table rate_limits, users cascade`);
});
afterAll(closeDb);

const SECRET = "test-secret-test-secret-test-secret-42";

describe("proxyUser: who is signed in, for the rate limiter", () => {
  const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  const cookie = (token: string) =>
    new Headers({ cookie: `better-auth.session_token=${encodeURIComponent(`${token}.sig`)}` });

  beforeEach(async () => {
    await db.insert(users).values([
      { id: "u-buyer", name: "Buyer", email: "b@example.com", role: "user" },
      { id: "u-agent", name: "Agent", email: "a@example.com", role: "agent" },
    ]);
  });

  it("finds the user and role behind a live session token", async () => {
    await db.insert(sessions).values({
      id: "s1",
      token: TOKEN,
      userId: "u-agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(await proxyUser(cookie(TOKEN), db, SECRET)).toEqual({
      userId: "u-agent",
      role: "agent",
    });
  });

  it("ignores an expired session, an unknown token, a forged cache cookie and no cookie", async () => {
    await db.insert(sessions).values({
      id: "s2",
      token: TOKEN,
      userId: "u-buyer",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await proxyUser(cookie(TOKEN), db, SECRET)).toBeNull();
    expect(await proxyUser(cookie("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"), db, SECRET)).toBeNull();
    const forged = new Headers({
      cookie: `better-auth.session_token=x.y; better-auth.session_data=${Buffer.from(
        JSON.stringify({ session: { user: { id: "u-agent", role: "admin" } }, signature: "nope" }),
      ).toString("base64url")}`,
    });
    expect(await proxyUser(forged, db, SECRET)).toBeNull();
    expect(await proxyUser(new Headers(), db, SECRET)).toBeNull();
  });

  it("reads the token out of Better Auth's signed cookie value", () => {
    expect(sessionTokenFromCookie(encodeURIComponent(`${TOKEN}.abc/def+==`))).toBe(TOKEN);
    expect(sessionTokenFromCookie("short.sig")).toBeNull();
    expect(sessionTokenFromCookie("%E0%A4%A")).toBeNull();
  });
});

describe("checkSignUp: spam checks on email sign-up", () => {
  const headers = (over: Record<string, string> = {}) =>
    new Headers({
      "x-forwarded-for": "203.0.113.50",
      [SIGN_UP_HONEYPOT_HEADER]: "",
      [SIGN_UP_ELAPSED_HEADER]: "6000",
      ...over,
    });
  const prod = { production: true };

  it("lets a person through", async () => {
    expect(await checkSignUp(db, headers(), "new@example.com", prod)).toEqual({ ok: true });
  });

  it("refuses the honeypot, a form sent too fast, and a post straight to the endpoint", async () => {
    const hp = await checkSignUp(db, headers({ [SIGN_UP_HONEYPOT_HEADER]: "x" }), "a@x.com", prod);
    expect(hp).toMatchObject({ ok: false, status: "BAD_REQUEST", spam: ["honeypot"] });
    const fast = await checkSignUp(
      db,
      headers({ [SIGN_UP_ELAPSED_HEADER]: "300" }),
      "b@x.com",
      prod,
    );
    expect(fast).toMatchObject({ ok: false, spam: ["too-fast"] });
    const direct = new Headers({ "x-forwarded-for": "203.0.113.51" });
    expect(await checkSignUp(db, direct, "c@x.com", prod)).toMatchObject({
      ok: false,
      spam: ["no-timer"],
    });
  });

  it("limits sign-ups per address and per email", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await checkSignUp(db, headers(), `p${i}@example.com`, prod));
    }
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true, false]);
    expect(results[5]).toMatchObject({ status: "TOO_MANY_REQUESTS" });

    await db.delete(rateLimits);
    const sameEmail = [];
    for (let i = 0; i < 4; i++) {
      sameEmail.push(
        await checkSignUp(
          db,
          headers({ "x-forwarded-for": `198.51.100.${i + 1}` }),
          "Same@Example.com",
          prod,
        ),
      );
    }
    expect(sameEmail.map((r) => r.ok)).toEqual([true, true, true, false]);
  });
});
