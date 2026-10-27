import { afterEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import { sendEmail } from "@/lib/email";
import { captureConsole } from "@/test/console";
import { sendLeadAssignedEmail } from "./notify";
import { submitInquiry } from "./submit";

/**
 * The lead emails with no RESEND_API_KEY: the lead is still saved, the sender
 * sees the usual thank-you, and the log holds one redacted line per email.
 * (notify.db.test.ts and submit.db.test.ts cover the rest against Postgres.)
 */

vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  return { ...mod, env: { ...mod.env, RESEND_API_KEY: undefined } };
});
vi.mock("@/lib/form-guard", () => ({
  hitFormLimits: async () => ({ ok: true }),
  countLeadToken: async () => true,
  isKnownCustomer: async () => false,
  retryPhrase: () => "a minute",
}));
vi.mock("@/lib/form-token", () => ({
  formTokenSecret: () => "secret",
  readFormToken: () => ({ id: "token-1", elapsedMs: 30_000 }),
}));

afterEach(() => vi.restoreAllMocks());

const SITE = "https://adams.example";

/** A query chain that resolves to `rows` however it's built. */
function chain(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["from", "where", "innerJoin", "leftJoin", "limit", "values", "returning"])
    q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return q;
}

function fakeDb(selects: unknown[][]) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    select: () => chain(selects.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return chain([{ id: "lead-1" }]);
      },
    }),
  };
  return { db: db as unknown as Executor, inserted };
}

const secrets = [
  "jordan.buyer",
  "Jordan Buyer",
  "andrea",
  "office@",
  "lake under",
  "/dashboard/leads",
];

describe("lead emails with no Resend key", () => {
  it("a new inquiry is saved, the sender thanked, and each email logged redacted", async () => {
    const { output } = captureConsole();
    const admins = [{ userId: "u-andrea", name: "Andrea", email: "andrea@adams.example" }];
    const { db, inserted } = fakeDb([admins]);
    const res = await submitInquiry(
      {
        type: "question",
        source: "contact",
        name: "Jordan Buyer",
        email: "jordan.buyer@example.com",
        message: "Anything near the lake under $300k?",
      },
      { ip: "198.51.100.7", userId: null, referer: "", userAgent: "Mozilla/5.0" },
      { db, send: sendEmail, siteUrl: SITE, inbox: "office@adams.example" },
    );
    expect(res).toMatchObject({ ok: true, id: "lead-1", spam: [] });
    expect(res.message).toBeTruthy();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ status: "new", email: "jordan.buyer@example.com" });

    const lines = output().filter((l) => !l.startsWith("email not configured"));
    expect(lines).toEqual([
      "[email] kind=lead-notice to_domain=adams.example status=not_configured",
      "[email] kind=lead-copy to_domain=adams.example status=not_configured",
    ]);
    for (const s of secrets) expect(output().join("\n")).not.toContain(s);
  });

  it("an assignment notice logs one redacted line and reports nobody emailed", async () => {
    const { output } = captureConsole();
    const row = {
      lead: {
        id: "lead-1",
        agentId: "agent-1",
        type: "question",
        name: "Jordan Buyer",
        email: "jordan.buyer@example.com",
        phone: null,
        message: "Anything near the lake under $300k?",
        tourAt: null,
        tourType: null,
        source: "contact",
      },
      listing: null,
      agent: {
        id: "agent-1",
        userId: "u-pat",
        mlsAgentId: null,
        name: "Pat Agent",
        email: "pat@adams.example",
      },
    };
    const { db } = fakeDb([[row]]);
    const to = await sendLeadAssignedEmail(
      { db, send: sendEmail, siteUrl: SITE },
      {
        inquiryId: "lead-1",
        agentId: "agent-1",
        assignedBy: { userId: "u-andrea", name: "Andrea" },
      },
    );
    expect(to).toBeNull();
    const lines = output().filter((l) => !l.startsWith("email not configured"));
    expect(lines).toEqual([
      "[email] kind=lead-assignment to_domain=adams.example status=not_configured",
    ]);
    for (const s of [...secrets, "pat@"]) expect(output().join("\n")).not.toContain(s);
  });
});
