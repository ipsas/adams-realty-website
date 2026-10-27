import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "@/test/console";

const h = vi.hoisted(() => ({
  env: {
    RESEND_API_KEY: undefined as string | undefined,
    EMAIL_FROM: "Adams Realty <hello@adams.example>",
    EMAIL_REPLY_TO: "office@adams.example" as string | undefined,
  },
}));
vi.mock("@/lib/env", () => ({ env: h.env }));

const { emailConfigured, sendEmail } = await import("./email");
import type { Email } from "./email";

const RESET_URL = "https://adams.example/reset-password/tok_SECRET123?callbackURL=%2F";
const email = (over: Partial<Email> = {}): Email => ({
  kind: "password-reset",
  to: "jordan.buyer@example.com",
  subject: "Reset your password",
  text: `Reset it here: ${RESET_URL}`,
  html: `<a href="${RESET_URL}">Reset</a>`,
  idempotencyKey: "reset:abc",
  headers: { "List-Unsubscribe": "<https://adams.example/u/tok_UNSUB>" },
  ...over,
});

let output: () => string[];
beforeEach(() => {
  ({ output } = captureConsole());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sendEmail with no RESEND_API_KEY", () => {
  beforeEach(() => {
    h.env.RESEND_API_KEY = undefined;
  });

  it("sends nothing, reports email_not_configured, and logs one redacted line", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(emailConfigured()).toBe(false);
    expect(await sendEmail(email())).toEqual({ ok: false, reason: "email_not_configured" });
    expect(fetch).not.toHaveBeenCalled();

    const lines = output().filter((l) => l.startsWith("[email]"));
    expect(lines).toEqual([
      "[email] kind=password-reset to_domain=example.com status=not_configured",
    ]);
    const all = output().join("\n");
    for (const secret of [
      "jordan.buyer",
      "Reset your password",
      "tok_SECRET123",
      "reset-password",
      "tok_UNSUB",
      "Reset it here",
    ])
      expect(all).not.toContain(secret);
  });

  it("names each recipient domain once, never the local part", async () => {
    await sendEmail(
      email({ kind: "lead-notice", to: ["a@one.example", "b@two.example", "c@One.example"] }),
    );
    expect(output()).toContain(
      "[email] kind=lead-notice to_domain=one.example,two.example status=not_configured",
    );
  });
});

describe("the one-time warning", () => {
  it("is printed on the first unconfigured send only", async () => {
    vi.resetModules();
    h.env.RESEND_API_KEY = undefined;
    const fresh = await import("./email");
    await fresh.sendEmail(email());
    await fresh.sendEmail(email());
    await fresh.sendEmail(email({ kind: "sync-alert" }));
    expect(
      output().filter((l) => l === "email not configured: RESEND_API_KEY missing"),
    ).toHaveLength(1);
    expect(output().filter((l) => l.includes("status=not_configured"))).toHaveLength(3);
  });
});

describe("sendEmail with a key", () => {
  beforeEach(() => {
    h.env.RESEND_API_KEY = "re_test_key";
  });

  it("posts the same payload to Resend as before and logs status=sent", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(emailConfigured()).toBe(true);
    expect(await sendEmail(email({ replyTo: "pat@adams.example" }))).toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer re_test_key",
        "Content-Type": "application/json",
        "Idempotency-Key": "reset:abc",
      },
      body: JSON.stringify({
        from: "Adams Realty <hello@adams.example>",
        to: ["jordan.buyer@example.com"],
        subject: "Reset your password",
        text: `Reset it here: ${RESET_URL}`,
        html: `<a href="${RESET_URL}">Reset</a>`,
        reply_to: "pat@adams.example",
        headers: { "List-Unsubscribe": "<https://adams.example/u/tok_UNSUB>" },
      }),
    });
    expect(output()).toEqual(["[email] kind=password-reset to_domain=example.com status=sent"]);
  });

  it("falls back to EMAIL_REPLY_TO and sends no Idempotency-Key header without an idempotency key", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await sendEmail(email({ idempotencyKey: undefined }));
    const init = fetch.mock.calls[0][1]!;
    expect(init.headers).not.toHaveProperty("Idempotency-Key");
    expect(JSON.parse(String(init.body)).reply_to).toBe("office@adams.example");
  });

  it("reports send_failed on an HTTP error and logs only kind, domain and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rejected jordan.buyer@example.com tok_SECRET123", { status: 500 }),
      ),
    );
    expect(await sendEmail(email())).toEqual({ ok: false, reason: "send_failed" });
    expect(output()).toEqual(["[email] kind=password-reset to_domain=example.com status=failed"]);
  });

  it("reports send_failed when the request itself fails, without the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED for jordan.buyer@example.com");
      }),
    );
    expect(await sendEmail(email())).toEqual({ ok: false, reason: "send_failed" });
    expect(output()).toEqual(["[email] kind=password-reset to_domain=example.com status=failed"]);
  });
});
