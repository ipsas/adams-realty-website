import { afterEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import { captureConsole } from "@/test/console";
import { runLeadDigests } from "./digest";

vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  return { ...mod, env: { ...mod.env, RESEND_API_KEY: undefined } };
});

afterEach(() => vi.restoreAllMocks());

/** A database that records every use: the run must not touch it. */
function untouchedDb() {
  const used: string[] = [];
  const db = new Proxy(
    {},
    {
      get: (_t, prop) => (
        used.push(String(prop)),
        () => {
          throw new Error("db used");
        }
      ),
    },
  );
  return { db: db as Executor, used };
}

describe("morning summary with no Resend key", () => {
  it("skips before claiming any day, and logs one line without addresses", async () => {
    const { output } = captureConsole();
    const { db, used } = untouchedDb();
    const res = await runLeadDigests({ db, now: new Date("2026-09-30T08:05:00-04:00") });
    expect(res).toMatchObject({ ok: true, skipped: "email-not-configured", emailed: 0, failed: 0 });
    expect(used).toEqual([]);
    expect(output()).toEqual(["[digest] skipped: email not configured"]);
  });

  it("still waits for the send hour first", async () => {
    captureConsole();
    const { db } = untouchedDb();
    const res = await runLeadDigests({ db, now: new Date("2026-09-30T05:00:00-04:00") });
    expect(res.skipped).toBe("before-send-hour");
  });
});
