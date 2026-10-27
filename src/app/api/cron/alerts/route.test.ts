import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The alerts cron with its jobs mocked: it also runs the staff's morning
// summary (12:00 UTC is 7 a.m. Eastern in winter), within a short budget, and
// reports it without letting it change the status.

const h = vi.hoisted(() => ({
  digests: [] as Array<Record<string, unknown>>,
  digestFails: false,
  alerts: 0,
  alertOpts: [] as Array<Record<string, unknown>>,
  configured: false,
}));
vi.mock("@/lib/email", () => ({ emailConfigured: () => h.configured }));
vi.mock("@/lib/email-batch", () => ({ createBatchBudget: () => ({ budget: "shared" }) }));
vi.mock("@/lib/cron-auth", () => ({
  isCronAuthorized: (r: Request) => r.headers.get("authorization") === "Bearer secret",
}));
vi.mock("@/lib/rate-limit-db", () => ({ pruneRateLimits: async () => {} }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/alerts/run", () => ({
  runAlerts: async (opts: Record<string, unknown>) => {
    h.alerts++;
    h.alertOpts.push(opts);
    return { ok: true, searches: {}, homes: {}, durationMs: 1 };
  },
}));
vi.mock("@/lib/leads/digest", () => ({
  runLeadDigests: async (opts: Record<string, unknown>) => {
    h.digests.push(opts);
    if (h.digestFails) throw new Error("db down");
    return { ok: true, emailed: 2 };
  },
}));

const { GET } = await import("./route");
const call = (auth = "Bearer secret") =>
  GET(new NextRequest("http://localhost/api/cron/alerts", { headers: { authorization: auth } }));

beforeEach(() => {
  h.digests = [];
  h.digestFails = false;
  h.alerts = 0;
  h.alertOpts = [];
  h.configured = false;
});

describe("GET /api/cron/alerts", () => {
  it("refuses a caller without the cron secret", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    expect(h.digests).toHaveLength(0);
  });

  it("sends the morning summary within 30 s, then the alerts, and reports both", async () => {
    const before = Date.now();
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.digests).toHaveLength(1);
    expect(h.digests[0].deadline as number).toBeGreaterThanOrEqual(before + 30_000);
    expect(h.digests[0].deadline as number).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(h.alerts).toBe(1);
    expect(await res.json()).toMatchObject({ ok: true, digests: { ok: true, emailed: 2 } });
  });

  it("gives the summary and the alerts one shared batch-mail guard", async () => {
    await call();
    expect(h.digests[0].budget).toEqual({ budget: "shared" });
    expect(h.alertOpts[0].budget).toBe(h.digests[0].budget);
  });

  it("reports whether email is configured, as a boolean only", async () => {
    expect((await (await call()).json()).email).toEqual({ configured: false });
    h.configured = true;
    expect((await (await call()).json()).email).toEqual({ configured: true });
  });

  it("still runs the alerts when the summary fails", async () => {
    h.digestFails = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.alerts).toBe(1);
    expect(await res.json()).toMatchObject({ digests: { ok: false } });
    error.mockRestore();
  });
});
