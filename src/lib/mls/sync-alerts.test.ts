import { describe, expect, it, vi } from "vitest";
import type { Email, SendEmail } from "@/lib/email";
import { captureConsole } from "@/test/console";
import { sendSyncAlert, syncAlertEmail, syncAlertKey } from "./sync-alerts";
import type { SyncAlert } from "./sync-engine";

vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  return { ...mod, env: { ...mod.env, RESEND_API_KEY: undefined } };
});

const alert = (over: Partial<SyncAlert> = {}): SyncAlert => ({
  mode: "incremental",
  at: new Date("2026-10-20T14:00:00Z"),
  atKey: "K000199",
  refusal: 1,
  escalated: false,
  rejected: 180,
  total: 200,
  firstErrorClass: "Postgres error 22003",
  ...over,
});

const admins = async () => [
  { userId: "u1", email: "broker@example.com" },
  { userId: "u2", email: "admin2@example.com" },
];

describe("sync alerts", () => {
  it("says what was refused and what happens next, with no row values or listing keys", () => {
    const { subject, text } = syncAlertEmail("gamls", alert());
    expect(subject).toBe("MLS sync gamls: page refused for quarantine (1 of 4)");
    expect(text).toContain("Source: gamls");
    expect(text).toContain("Cursor: 2026-10-20T14:00:00.000Z");
    expect(text).toContain("Rejected: 180 of 200 rows on the page");
    expect(text).toContain("First error: Postgres error 22003");
    expect(text).toContain("Refusal 1 of 4: nothing of the page was written and the cursor stays.");
    expect(text).not.toContain("K000199");

    const escalated = syncAlertEmail("gamls", alert({ refusal: 4, escalated: true }));
    expect(escalated.subject).toMatch(/quarantined and skipped after 4 refusals/);
    expect(escalated.text).toContain("Escalated: quarantined and advanced.");
    // Redacted again, in case a class ever carries an address.
    expect(
      syncAlertEmail("gamls", alert({ firstErrorClass: "X at 12 Main St" })).text,
    ).not.toContain("12 Main St");
  });

  it("emails every admin, keyed by source, cursor and refusal, so a retry doesn't double-send", async () => {
    const send = vi.fn<SendEmail>(async () => ({ ok: true }));
    await sendSyncAlert("gamls", alert({ refusal: 2 }), { recipients: admins, send });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([
      "broker@example.com",
      "admin2@example.com",
    ]);
    const key = send.mock.calls[0][0].idempotencyKey!;
    expect(key).toMatch(/^mls-quarantine:gamls:[0-9a-f]{16}:refusal-2:u1$/);
    expect(key).not.toContain("K000199");
    expect(syncAlertKey("gamls", alert({ refusal: 2 }), "u1")).toBe(key);
    expect(syncAlertKey("gamls", alert({ refusal: 3 }), "u1")).not.toBe(key);
    expect(syncAlertKey("gamls", alert({ atKey: "K000200", refusal: 2 }), "u1")).not.toBe(key);
    expect(syncAlertKey("gamls", alert({ refusal: 4, escalated: true }), "u1")).toMatch(
      /:escalated:u1$/,
    );
  });

  it("never throws: a failed send is logged redacted and the other admins still get it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async (email: Email) => {
      if (email.to === "broker@example.com")
        throw new Error("Email send failed (500): broker@example.com");
      return { ok: true as const };
    });
    await expect(
      sendSyncAlert("gamls", alert(), { recipients: admins, send }),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    const logged = error.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("sync alert email failed");
    expect(logged).not.toContain("broker@example.com");

    await expect(
      sendSyncAlert("gamls", alert(), {
        recipients: async () => {
          throw new Error("connection lost");
        },
        send,
      }),
    ).resolves.toBeUndefined();
    error.mockRestore();
  });

  it("with no Resend key: one redacted line per admin, nothing sent, nothing thrown", async () => {
    const { output, restore } = captureConsole();
    await expect(sendSyncAlert("gamls", alert(), { recipients: admins })).resolves.toBeUndefined();
    expect(output().filter((l) => l.startsWith("[email]"))).toEqual([
      "[email] kind=sync-alert to_domain=example.com status=not_configured",
      "[email] kind=sync-alert to_domain=example.com status=not_configured",
    ]);
    const all = output().join("\n");
    for (const s of ["broker@", "admin2@", "MLS sync gamls", "Rejected:", "K000199"])
      expect(all).not.toContain(s);
    restore();
  });
});
