import { describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import type { Email } from "@/lib/email";
import { captureConsole } from "@/test/console";
import {
  isOutboxKind,
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

/**
 * A db whose every query chain resolves to the one claimed row `ROW` (a
 * pending lead notice, with `fields`); each `.set(...)` value is pushed to `sets`.
 */
function fakeDb(fields: Record<string, unknown> = {}, sets: unknown[] = []): Executor {
  const row = { id: ROW, kind: "lead-notice", attempts: 1, state: "pending", ...fields };
  const chain: object = new Proxy(() => {}, {
    get: (_t, prop) =>
      prop === "then"
        ? (resolve: (v: unknown) => void) => resolve([row])
        : prop === "set"
          ? (v: unknown) => (sets.push(v), chain)
          : () => chain,
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

describe("processEmailOutbox's payload", () => {
  it("is stored, with first_tried_at, on the first outbox try before it is sent", async () => {
    captureConsole();
    const sets: unknown[] = [];
    const send = vi.fn(async () => {
      // Already stored when the send starts.
      expect(sets).toContainEqual(
        expect.objectContaining({
          payload: { ...email, idempotencyKey: `outbox/${ROW}` },
          firstTriedAt: expect.anything(),
        }),
      );
      return { ok: true as const };
    });
    await processEmailOutbox({ db: fakeDb({}, sets), send, rebuild: async () => email });
    expect(send).toHaveBeenCalledWith({ ...email, idempotencyKey: `outbox/${ROW}` });
  });

  it("is what a later try sends, whatever the rebuild now says, and is not stored again", async () => {
    captureConsole();
    const sets: unknown[] = [];
    const stored = { ...email, idempotencyKey: `outbox/${ROW}` };
    const send = vi.fn(async () => ({ ok: true as const }));
    const rebuild = vi.fn(async () => ({ ...email, text: "Jordan asked about 14 Oak Street." }));
    const run = await processEmailOutbox({
      db: fakeDb({ payload: stored, firstTriedAt: new Date(Date.now() - 60 * 60_000) }, sets),
      send,
      rebuild,
    });
    expect(run).toEqual({ sent: 1, retry: 0, dead: 0, gone: 0 });
    // Rebuilt to check the lead and recipient are still there; not sent.
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(stored);
    expect(sets.filter((s) => Object.hasOwn(s as object, "payload"))).toHaveLength(0);
  });
});

describe("processEmailOutbox with a key that may have expired", () => {
  it("sends nothing and marks the row dead, clearing its payload", async () => {
    const { output } = captureConsole();
    const sets: unknown[] = [];
    const send = vi.fn();
    const rebuild = vi.fn(async () => email);
    const run = await processEmailOutbox({
      db: fakeDb(
        {
          payload: { ...email, idempotencyKey: `outbox/${ROW}` },
          firstTriedAt: new Date(Date.now() - 23.5 * 60 * 60_000),
        },
        sets,
      ),
      send,
      rebuild,
    });
    expect(run).toEqual({ sent: 0, retry: 0, dead: 1, gone: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(sets).toContainEqual(
      expect.objectContaining({ state: "dead", lastStatus: "key_expired", payload: null }),
    );
    expect(output()).toContain(
      `[email-outbox] kind=lead-notice id=${ROW} status=dead last=key_expired`,
    );
    expect(output().join("\n")).not.toContain("Oak Street");
  });
});

describe("processEmailOutbox with a kind it doesn't know", () => {
  it("rebuilds and sends nothing, and marks the row dead", async () => {
    const { output } = captureConsole();
    const sets: unknown[] = [];
    const send = vi.fn();
    const rebuild = vi.fn(async () => email);
    const run = await processEmailOutbox({
      db: fakeDb({ kind: "lead-mystery" }, sets),
      send,
      rebuild,
    });
    expect(run).toEqual({ sent: 0, retry: 0, dead: 1, gone: 0 });
    expect(rebuild).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(sets).toContainEqual(
      expect.objectContaining({ state: "dead", lastStatus: "unknown_kind" }),
    );
    expect(output()).toContain(
      `[email-outbox] kind=lead-mystery id=${ROW} status=dead last=unknown_kind`,
    );
  });
});

describe("isOutboxKind", () => {
  it("knows the three notice kinds only", () => {
    for (const kind of ["lead-notice", "lead-copy", "lead-assignment"])
      expect(isOutboxKind(kind)).toBe(true);
    for (const kind of ["lead-mystery", "", "toString", "__proto__"])
      expect(isOutboxKind(kind)).toBe(false);
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
