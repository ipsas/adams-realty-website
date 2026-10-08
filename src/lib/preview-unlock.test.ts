import { afterEach, describe, expect, it, vi } from "vitest";
import { FORM_LIMITS } from "./form-guard";
import { previewToken, verifyPreviewToken } from "./preview-gate";
import { attemptUnlock, type UnlockDeps } from "./preview-unlock";
import type { LimitResult } from "./rate-limit-db";

const SECRET = "test-secret-test-secret-test-secret-0000";
const PASSWORD = "dogwood-spring";
const OK: LimitResult = { ok: true, retryAfter: 0, exceeded: null };

afterEach(() => vi.restoreAllMocks());

function deps(over: Partial<UnlockDeps> = {}) {
  const countAttempt = vi.fn(async () => OK);
  return { countAttempt, password: PASSWORD, secret: SECRET, ...over } satisfies UnlockDeps;
}

describe("unlocking the preview", () => {
  it("allows 10 tries per address per 15 minutes", () => {
    expect(FORM_LIMITS["preview-unlock"].ip).toEqual([
      { name: "preview-unlock-ip:15m", limit: 10, ms: 15 * 60_000 },
    ]);
  });

  it("the right password gives the cookie token and the safe destination", async () => {
    const d = deps();
    const r = await attemptUnlock({ password: ` ${PASSWORD} `, next: "/homes?q=Royston" }, d);
    expect(r).toEqual({
      ok: true,
      token: await previewToken(PASSWORD, SECRET),
      next: "/homes?q=Royston",
    });
    expect(r.ok && (await verifyPreviewToken(r.token, PASSWORD, SECRET))).toBe(true);
    expect(d.countAttempt).toHaveBeenCalledTimes(1);
  });

  it("carries on to a link from an account email (the form opens it as a page load)", async () => {
    const next = "/api/auth/reset-password/abc123?callbackURL=%2Freset-password";
    const r = await attemptUnlock({ password: PASSWORD, next }, deps());
    expect(r.ok && r.next).toBe(next);
  });

  it("never sends anyone off the site, or back to the coming-soon page", async () => {
    for (const next of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/preview",
      null,
    ]) {
      const r = await attemptUnlock({ password: PASSWORD, next }, deps());
      expect(r.ok && r.next, String(next)).toBe("/");
    }
  });

  it("a wrong password is counted and refused, with no hint", async () => {
    const d = deps();
    const r = await attemptUnlock({ password: "dogwood-sprin", next: "/" }, d);
    expect(r).toEqual({
      ok: false,
      reason: "wrong",
      message: "That PIN didn't work. Please try again.",
    });
    expect(d.countAttempt).toHaveBeenCalledTimes(1);
    // Overlong input is never a match (and isn't hashed).
    const long = await attemptUnlock(
      { password: PASSWORD + " ".repeat(10) + "x".repeat(300), next: "/" },
      d,
    );
    expect(long.ok).toBe(false);
  });

  it("an empty field asks for the password without counting a try", async () => {
    const d = deps();
    for (const password of ["", "   ", null, new Blob(["x"])]) {
      const r = await attemptUnlock({ password, next: "/" }, d);
      expect(r.ok === false && r.reason).toBe("empty");
    }
    expect(d.countAttempt).not.toHaveBeenCalled();
  });

  it("over the limit, even the right password waits", async () => {
    const d = deps({
      countAttempt: vi.fn(async () => ({
        ok: false,
        retryAfter: 600,
        exceeded: "preview-unlock-ip:15m",
      })),
    });
    const r = await attemptUnlock({ password: PASSWORD, next: "/" }, d);
    expect(r).toEqual({
      ok: false,
      reason: "busy",
      message: "Too many tries from here. Please try again in about 10 minutes.",
    });
  });

  it("fails closed when the limiter can't reach the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      countAttempt: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      }),
    });
    const r = await attemptUnlock({ password: PASSWORD, next: "/" }, d);
    expect(r).toEqual({
      ok: false,
      reason: "unavailable",
      message: "We couldn't check that just now. Please try again later.",
    });
  });

  it("does nothing while the gate is off", async () => {
    const d = deps({ password: null });
    expect((await attemptUnlock({ password: PASSWORD, next: "/" }, d)).ok).toBe(false);
    expect(d.countAttempt).not.toHaveBeenCalled();
  });
});
