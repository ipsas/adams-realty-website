import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "@/test/console";

const h = vi.hoisted(() => ({
  env: {
    RESEND_API_KEY: undefined as string | undefined,
    EMAIL_FROM: "Adams Realty <hello@adams.example>",
    EMAIL_REPLY_TO: "office@adams.example" as string | undefined,
  },
  counted: [] as number[],
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
// The send counter is tested in email-batch.test.ts.
vi.mock("@/lib/email-batch", () => ({
  BATCH_EMAIL_KINDS: new Set(["search-alert"]),
  countSent: async (n: number) => {
    h.counted.push(n);
  },
}));

const {
  emailConfigured,
  parseRetryAfter,
  sendEmail,
  sendTransactional,
  RETRY_ATTEMPTS,
  RETRY_WAIT_CAP_MS,
  SEND_TIMEOUT_MS,
} = await import("./email");
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A Resend that never answers: the request only ends when aborted, as fetch does. */
function hangs() {
  const fetch = vi.fn<typeof globalThis.fetch>(
    (_url, init) =>
      new Promise((_resolve, reject) =>
        init!.signal!.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

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
      signal: expect.any(AbortSignal),
    });
    expect(output()).toEqual(["[email] kind=password-reset to_domain=example.com status=sent"]);
  });

  it("clears its timeout once Resend answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    expect(await sendEmail(email())).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    expect(await sendEmail(email())).toMatchObject({ ok: false, status: 500 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a request with no answer after SEND_TIMEOUT_MS and reports it as a timeout", async () => {
    vi.useFakeTimers();
    const fetch = hangs();
    let settled = false;
    const pending = sendEmail(email()).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, reason: "send_failed", timedOut: true });
    expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(output()).toEqual(["[email] kind=password-reset to_domain=example.com status=timeout"]);
    expect(output().join("\n")).not.toMatch(/jordan\.buyer|tok_SECRET123|reset:abc|aborted/);
  });

  it("falls back to EMAIL_REPLY_TO and sends no Idempotency-Key header without an idempotency key", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await sendEmail(email({ idempotencyKey: undefined }));
    const init = fetch.mock.calls[0][1]!;
    expect(init.headers).not.toHaveProperty("Idempotency-Key");
    expect(JSON.parse(String(init.body)).reply_to).toBe("office@adams.example");
  });

  it("reports send_failed on an HTTP error and logs only kind, domain, status and the code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rejected jordan.buyer@example.com tok_SECRET123", { status: 500 }),
      ),
    );
    expect(await sendEmail(email())).toEqual({ ok: false, reason: "send_failed", status: 500 });
    expect(output()).toEqual([
      "[email] kind=password-reset to_domain=example.com status=failed http=500",
    ]);
  });

  it("reports rate_limited on a 429, with the code but never Resend's reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"message":"Too many requests for jordan.buyer@example.com"}', {
            status: 429,
          }),
      ),
    );
    expect(await sendEmail(email({ kind: "search-alert" }))).toEqual({
      ok: false,
      reason: "rate_limited",
      status: 429,
    });
    expect(output()).toEqual([
      "[email] kind=search-alert to_domain=example.com status=failed http=429",
    ]);
    expect(output().join("\n")).not.toMatch(/Too many|jordan\.buyer|tok_SECRET123/);
  });

  it("reports send_failed when the request itself fails, without the error or a code", async () => {
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

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  it("reads seconds and HTTP dates; ignores what it can't read", () => {
    expect(parseRetryAfter("2", now)).toBe(2000);
    expect(parseRetryAfter("Tue, 27 Oct 2026 12:00:01 GMT", now)).toBe(1000);
    expect(parseRetryAfter("Tue, 27 Oct 2026 11:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("soon", now)).toBeUndefined();
  });
});

describe("sendTransactional", () => {
  beforeEach(() => {
    h.env.RESEND_API_KEY = "re_test_key";
    h.counted.length = 0;
  });

  /** A fetch answering with `statuses` in turn ("throw": the request fails). */
  function answers(...replies: Array<number | "throw" | [number, string]>) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const r = replies.shift() ?? 200;
      if (r === "throw") throw new Error("connect ECONNRESET");
      const [status, retryAfter] = Array.isArray(r) ? r : [r, undefined];
      return new Response("{}", {
        status,
        headers: retryAfter ? { "Retry-After": retryAfter } : {},
      });
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  beforeEach(() => {
    sleeps.length = 0;
  });

  it("retries a 429, then sends; counted once", async () => {
    const fetch = answers(429, 200);
    expect(await sendTransactional(email(), { sleep })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([250]);
    expect(h.counted).toEqual([1]);
  });

  it("gives up after three 503s and reports the last failure, counting nothing", async () => {
    const fetch = answers(503, 503, 503);
    expect(await sendTransactional(email(), { sleep })).toEqual({
      ok: false,
      reason: "send_failed",
      status: 503,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([250, 500]);
    expect(h.counted).toEqual([]);
    expect(output().filter((l) => l.includes("status=failed http=503"))).toHaveLength(3);
  });

  it("waits what Retry-After asks, and stops when that would pass the cap", async () => {
    answers([429, "1"], [429, "Tue, 27 Oct 2099 12:00:00 GMT"], 200);
    const res = await sendTransactional(email(), { sleep });
    expect(res).toMatchObject({ ok: false, reason: "rate_limited", status: 429 });
    expect(sleeps).toEqual([1000]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RETRY_WAIT_CAP_MS);

    sleeps.length = 0;
    answers([503, "2"], [503, "2"], 200);
    expect(await sendTransactional(email(), { sleep })).toMatchObject({ status: 503 });
    expect(sleeps).toEqual([2000]);
  });

  it("never retries another 4xx", async () => {
    const fetch = answers(400, 200);
    expect(await sendTransactional(email(), { sleep })).toMatchObject({ ok: false, status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("retries a request that failed outright, with one idempotency key for every try", async () => {
    const fetch = answers("throw", 200);
    expect(await sendTransactional(email({ idempotencyKey: undefined }), { sleep })).toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const keys = fetch.mock.calls.map(
      ([, init]) => (init!.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(h.counted).toEqual([1]);
  });

  it("retries a timed-out request with the same key, and gives up after RETRY_ATTEMPTS", async () => {
    vi.useFakeTimers();
    const fetch = hangs();
    const pending = sendTransactional(email({ idempotencyKey: undefined }), { sleep });
    await vi.advanceTimersByTimeAsync(RETRY_ATTEMPTS * SEND_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, reason: "send_failed", timedOut: true });
    expect(fetch).toHaveBeenCalledTimes(RETRY_ATTEMPTS);
    const keys = fetch.mock.calls.map(
      ([, init]) => (init!.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(keys).size).toBe(1);
    expect(sleeps).toEqual([250, 500]);
    expect(output().filter((l) => l.endsWith("status=timeout"))).toHaveLength(RETRY_ATTEMPTS);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.counted).toEqual([]);
  });

  /** A Resend 409 with its JSON error body (which holds nothing personal here). */
  const conflict = (name: string) =>
    new Response(JSON.stringify({ statusCode: 409, name, message: "Idempotency conflict" }), {
      status: 409,
    });
  const keysOf = (fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>) =>
    fetch.mock.calls.map(
      ([, init]) => (init!.headers as Record<string, string>)["Idempotency-Key"],
    );

  it("retries a 409 concurrent_idempotent_requests with the same key", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch
      .mockResolvedValueOnce(conflict("concurrent_idempotent_requests"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await sendTransactional(email(), { sleep })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(keysOf(fetch)).toEqual(["reset:abc", "reset:abc"]);
    expect(sleeps).toEqual([250]);
    // The 409 is logged by its status only, never its body.
    expect(
      output()
        .filter((l) => l.startsWith("[email]"))
        .sort(),
    ).toEqual([
      "[email] kind=password-reset to_domain=example.com status=failed http=409",
      "[email] kind=password-reset to_domain=example.com status=sent",
    ]);
  });

  it("never retries a 409 invalid_idempotent_request, and says which 409 it was", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      conflict("invalid_idempotent_request"),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await sendTransactional(email(), { sleep })).toEqual({
      ok: false,
      reason: "send_failed",
      status: 409,
      conflict: "invalid_idempotent_request",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("treats a 409 with an unknown or unreadable body as final, with no conflict", async () => {
    for (const body of [JSON.stringify({ name: "something_else" }), "not json"]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status: 409 }));
      vi.stubGlobal("fetch", fetch);
      expect(await sendTransactional(email(), { sleep })).toEqual({
        ok: false,
        reason: "send_failed",
        status: 409,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("tries batch kinds once: their guard defers them", async () => {
    const fetch = answers(429, 200);
    expect(await sendTransactional(email({ kind: "search-alert" }), { sleep })).toMatchObject({
      reason: "rate_limited",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry when email isn't configured", async () => {
    h.env.RESEND_API_KEY = undefined;
    const fetch = answers();
    expect(await sendTransactional(email(), { sleep })).toEqual({
      ok: false,
      reason: "email_not_configured",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
