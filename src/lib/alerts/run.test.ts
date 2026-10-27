import { afterEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import { captureConsole } from "@/test/console";
import { runAlerts } from "./run";

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

describe("alert run with no Resend key", () => {
  it("claims nothing (no last_alerted_at or last_notified_at advanced) and says it skipped", async () => {
    const { output } = captureConsole();
    const { db, used } = untouchedDb();
    const res = await runAlerts({ db, now: new Date("2026-09-30T12:00:00Z") });
    expect(res).toMatchObject({
      ok: true,
      skipped: "email-not-configured",
      searches: { due: 0, emailed: 0, failed: 0 },
      homes: { users: 0, emailed: 0, failed: 0 },
    });
    expect(used).toEqual([]);
    expect(output()).toEqual(["[alerts] skipped: email not configured"]);
  });
});
