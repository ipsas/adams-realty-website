import { describe, expect, it } from "vitest";
import type { Email } from "@/lib/email";
import { outboxIdempotencyKey } from "./email-outbox";

const ROW = "6f1c2a9e-1b2d-4c3e-9f8a-0123456789ab";
const email: Email = {
  kind: "lead-notice",
  to: "pat@adams.example",
  subject: "New lead: 12 Oak Street",
  text: "Jordan asked about 12 Oak Street.",
  html: "<p>Jordan asked about 12 Oak Street.</p>",
};

describe("outboxIdempotencyKey", () => {
  it("is stable for the same body", () => {
    expect(outboxIdempotencyKey(ROW, { ...email })).toBe(outboxIdempotencyKey(ROW, email));
    // Fields outside the body don't change it.
    expect(outboxIdempotencyKey(ROW, { ...email, idempotencyKey: "lead-new:1" })).toBe(
      outboxIdempotencyKey(ROW, email),
    );
  });

  it("changes when the body or the row changes", () => {
    const key = outboxIdempotencyKey(ROW, email);
    for (const changed of [
      { ...email, to: "office@adams.example" },
      { ...email, subject: "New lead: 14 Oak Street" },
      { ...email, text: "Jordan asked about 14 Oak Street." },
      { ...email, html: undefined },
    ]) {
      expect(outboxIdempotencyKey(ROW, changed)).not.toBe(key);
    }
    expect(outboxIdempotencyKey(ROW.replace("6f", "7f"), email)).not.toBe(key);
  });

  it("holds no address or subject text and fits Resend's 256 chars", () => {
    const key = outboxIdempotencyKey(ROW, email);
    expect(key).toMatch(/^outbox\/[0-9a-f-]{36}\/[0-9a-f]{16}$/);
    expect(key).not.toMatch(/adams|Oak|@/);
    expect(key.length).toBeLessThanOrEqual(256);
  });
});
