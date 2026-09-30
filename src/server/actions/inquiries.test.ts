import { describe, expect, it, vi } from "vitest";

// The public lead form's server action: the lead is stored by submitInquiry,
// and its emails go through afterResponse (Next's after()), so they finish
// after the thank-you instead of being cut off when the function ends.

const h = vi.hoisted(() => ({
  deps: null as null | { defer?: (task: () => Promise<unknown>) => void },
  scheduled: [] as Array<{ label: string; task: () => Promise<unknown> }>,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "UA" }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/leads/deliver", () => ({
  afterResponse: (label: string, task: () => Promise<unknown>) =>
    void h.scheduled.push({ label, task }),
}));
vi.mock("@/lib/leads/submit", () => ({
  submitInquiry: async (_raw: unknown, _ctx: unknown, deps: typeof h.deps) => {
    h.deps = deps;
    deps!.defer!(async () => "sent");
    return { ok: true, message: "Thanks", id: "x" };
  },
}));

const { createInquiry } = await import("./inquiries");

describe("createInquiry", () => {
  it("defers the lead emails to after the response", async () => {
    const res = await createInquiry({ ok: false }, new FormData());
    expect(res).toEqual({ ok: true, message: "Thanks", errors: undefined });
    expect(h.deps?.defer).toBeTypeOf("function");
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].label).toBe("inquiry emails");
    await expect(h.scheduled[0].task()).resolves.toBe("sent");
  });
});
