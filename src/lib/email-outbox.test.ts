import { describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import type { Email } from "@/lib/email";
import { captureConsole } from "@/test/console";
import {
  OUTBOX_MIN_TIME_MS,
  outboxIdempotencyKey,
  outboxStatus,
  processEmailOutbox,
} from "./email-outbox";

const ROW = "6f1c2a9e-1b2d-4c3e-9f8a-0123456789ab";
const email: Email = {
  kind: "lead-notice",
  to: "pat@adams.example",
  subject: "New lead: 12 Oak Street",
  text: "Jordan asked about 12 Oak Street.",
  html: "<p>Jordan asked about 12 Oak Street.</p>",
};

/** A db whose every query chain resolves to the one claimed row `ROW`. */
function fakeDb(): Executor {
  const row = { id: ROW, kind: "lead-notice", attempts: 1, state: "pending" };
  const chain: object = new Proxy(() => {}, {
    get: (_t, prop) =>
      prop === "then" ? (resolve: (v: unknown) => void) => resolve([row]) : () => chain,
    apply: () => chain,
  });
  return chain as Executor;
}

describe("outboxIdempotencyKey", () => {
  it("is outbox/<row id>, one per row", () => {
    expect(outboxIdempotencyKey(ROW)).toBe(`outbox/${ROW}`);
    expect(outboxIdempotencyKey(ROW.replace("6f", "7f"))).not.toBe(outboxIdempotencyKey(ROW));
  });
});

describe("processEmailOutbox's key", () => {
  it("is the same on every try of a row, whatever the rebuilt body", async () => {
    captureConsole();
    const bodies = [email, { ...email, text: "Jordan asked about 14 Oak Street." }];
    const keys: (string | undefined)[] = [];
    for (const body of bodies) {
      await processEmailOutbox({
        db: fakeDb(),
        send: async (e) => (keys.push(e.idempotencyKey), { ok: true }),
        rebuild: async () => body,
      });
    }
    expect(keys).toEqual([`outbox/${ROW}`, `outbox/${ROW}`]);
  });
});

describe("outboxStatus", () => {
  it("tells a timeout from another failed request", () => {
    expect(outboxStatus({ ok: false, reason: "send_failed", timedOut: true })).toBe("timeout");
    expect(outboxStatus({ ok: false, reason: "send_failed" })).toBe("network");
    expect(outboxStatus({ ok: false, reason: "send_failed", status: 503 })).toBe("http_503");
  });

  it("names Resend's two idempotency 409s", () => {
    const res = { ok: false, reason: "send_failed", status: 409 } as const;
    expect(outboxStatus({ ...res, conflict: "concurrent_idempotent_requests" })).toBe(
      "409_concurrent",
    );
    expect(outboxStatus({ ...res, conflict: "invalid_idempotent_request" })).toBe(
      "409_payload_changed",
    );
    expect(outboxStatus(res)).toBe("http_409");
  });
});

describe("processEmailOutbox near its deadline", () => {
  it("claims and sends nothing with less than OUTBOX_MIN_TIME_MS left", async () => {
    const db = new Proxy({} as Executor, {
      get: () => {
        throw new Error("the database was touched");
      },
    });
    const send = vi.fn();
    const run = await processEmailOutbox({
      db,
      send,
      rebuild: async () => null,
      deadline: Date.now() + OUTBOX_MIN_TIME_MS - 1000,
    });
    expect(run).toEqual({ sent: 0, retry: 0, dead: 0, gone: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
