import { describe, expect, it } from "vitest";
import {
  HOME_ALERTS_SCOPE,
  signUnsubscribeToken,
  TOKEN_TTL_MS,
  unsubscribeUrls,
  verifyUnsubscribeToken,
} from "./token";

const secret = "test-secret-test-secret-test-secret-123";
const now = new Date("2026-09-25T12:00:00Z");
const searchId = "2de20de7-c175-4de6-9df0-5b663e0da0e0";
const target = { userId: "user_123", scope: searchId };

describe("unsubscribe tokens", () => {
  it("round-trips a user and scope", () => {
    const token = signUnsubscribeToken(target, { secret, now });
    expect(verifyUnsubscribeToken(token, { secret, now })).toEqual(target);
    const homes = signUnsubscribeToken({ userId: "u", scope: HOME_ALERTS_SCOPE }, { secret, now });
    expect(verifyUnsubscribeToken(homes, { secret, now })).toEqual({ userId: "u", scope: "homes" });
  });

  it("rejects a token signed with another secret", () => {
    const token = signUnsubscribeToken(target, { secret, now });
    expect(verifyUnsubscribeToken(token, { secret: `${secret}-rotated`, now })).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const token = signUnsubscribeToken(target, { secret, now });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ u: "someone_else", s: searchId, e: 4_000_000_000 }),
    ).toString("base64url");
    expect(verifyUnsubscribeToken(`${forged}.${sig}`, { secret, now })).toBeNull();
    const flipped = sig.slice(0, -2) + (sig.at(-2) === "A" ? "B" : "A") + sig.at(-1);
    expect(verifyUnsubscribeToken(`${body}.${flipped}`, { secret, now })).toBeNull();
    expect(verifyUnsubscribeToken(`${body}.${sig}.extra`, { secret, now })).toBeNull();
  });

  it("expires", () => {
    const token = signUnsubscribeToken(target, { secret, now });
    const justBefore = new Date(now.getTime() + TOKEN_TTL_MS - 1000);
    const after = new Date(now.getTime() + TOKEN_TTL_MS + 1000);
    expect(verifyUnsubscribeToken(token, { secret, now: justBefore })).toEqual(target);
    expect(verifyUnsubscribeToken(token, { secret, now: after })).toBeNull();
  });

  it("rejects garbage and invalid scopes", () => {
    for (const bad of [undefined, null, "", "abc", "a.b", "..", "x".repeat(2000)]) {
      expect(verifyUnsubscribeToken(bad, { secret, now })).toBeNull();
    }
    expect(() => signUnsubscribeToken({ userId: "u", scope: "everything" }, { secret })).toThrow();
  });

  it("builds page and one-click links carrying the same token", () => {
    const urls = unsubscribeUrls(target, { secret, now });
    expect(urls.page).toMatch(/\/alerts\/unsubscribe\?token=/);
    expect(urls.oneClick).toMatch(/\/alerts\/one-click\?token=/);
    const token = new URL(urls.oneClick).searchParams.get("token")!;
    expect(new URL(urls.page).searchParams.get("token")).toBe(token);
    expect(verifyUnsubscribeToken(token, { secret, now })).toEqual(target);
  });
});
