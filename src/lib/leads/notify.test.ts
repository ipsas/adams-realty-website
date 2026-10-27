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
  for (const m of [
    "from",
    "where",
    "innerJoin",
    "leftJoin",
    "limit",
    "values",
    "returning",
    "onConflictDoNothing",
  ])
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

describe("a lead notice that still fails after the in-request retries", () => {
  const failed = (status?: number) =>
    vi.fn(async () => ({ ok: false as const, reason: "send_failed" as const, status }));
  /** The outbox rows inserted: everything after the lead itself. */
  const OUTBOX_KEYS = [
    "attempts",
    "entityId",
    "kind",
    "lastStatus",
    "nextAttemptAt",
    "recipientId",
    "recipientRole",
  ];
  const noPii = (rows: Record<string, unknown>[]) => {
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(OUTBOX_KEYS);
    // nextAttemptAt is SQL (`now() + interval`), not a value.
    const dump = JSON.stringify(rows, (k, v) => (k === "nextAttemptAt" ? undefined : v));
    for (const s of [...secrets, "@", "jordan", "Pat", "pat@", "http://", "https://"])
      expect(dump).not.toContain(s);
  };

  it("queues the new lead's notice and each copy by reference only", async () => {
    const { output } = captureConsole();
    const admins = [{ userId: "u-1", name: "Andrea", email: "andrea@adams.example" }];
    const { db, inserted } = fakeDb([admins]);
    await submitInquiry(
      {
        type: "question",
        source: "contact",
        name: "Jordan Buyer",
        email: "jordan.buyer@example.com",
        message: "Anything near the lake under $300k?",
      },
      { ip: "198.51.100.8", userId: null, referer: "", userAgent: "Mozilla/5.0" },
      { db, send: failed(503), siteUrl: SITE, inbox: "office@adams.example" },
    );
    const queued = inserted.slice(1);
    expect(queued).toEqual([
      expect.objectContaining({
        kind: "lead-notice",
        entityId: "lead-1",
        recipientRole: "office",
        recipientId: null,
        lastStatus: "http_503",
        attempts: 1,
      }),
      expect.objectContaining({
        kind: "lead-copy",
        entityId: "lead-1",
        recipientRole: "admin",
        recipientId: "u-1",
        lastStatus: "http_503",
        attempts: 1,
      }),
    ]);
    noPii(queued);
    expect(output()).toEqual([
      "[email-outbox] kind=lead-notice entity=lead-1 status=queued last=http_503",
      "[email-outbox] kind=lead-copy entity=lead-1 status=queued last=http_503",
    ]);
  });

  it("queues an assignment notice with the agent's id; a send that threw too", async () => {
    captureConsole();
    const row = {
      lead: {
        id: "lead-1",
        agentId: "agent-1",
        type: "question",
        name: "Jordan Buyer",
        email: "jordan.buyer@example.com",
        phone: "706-555-1234",
        message: "Anything near the lake under $300k?",
        tourAt: null,
        tourType: null,
        source: "contact",
      },
      listing: null,
      agent: { id: "agent-1", userId: "u-pat", mlsAgentId: null, name: "Pat", email: "pat@a.b" },
    };
    const input = {
      inquiryId: "lead-1",
      agentId: "agent-1",
      assignedBy: { userId: "u-1", name: "Andrea" },
    };
    const { db, inserted } = fakeDb([[row], [row]]);
    expect(await sendLeadAssignedEmail({ db, send: failed(), siteUrl: SITE }, input)).toBeNull();
    const threw = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await sendLeadAssignedEmail({ db, send: threw, siteUrl: SITE }, input)).toBeNull();
    expect(inserted).toEqual([
      expect.objectContaining({
        kind: "lead-assignment",
        entityId: "lead-1",
        recipientRole: "agent",
        recipientId: "agent-1",
        lastStatus: "network",
      }),
      expect.objectContaining({ kind: "lead-assignment", lastStatus: "error" }),
    ]);
    noPii(inserted);
  });

  it("queues nothing when email isn't configured, or when the send went", async () => {
    captureConsole();
    const { db, inserted } = fakeDb([[], []]);
    for (const send of [sendEmail, vi.fn(async () => ({ ok: true as const }))])
      await submitInquiry(
        {
          type: "question",
          source: "contact",
          name: "Jordan Buyer",
          email: "jordan.buyer@example.com",
          message: "Anything near the lake under $300k?",
        },
        { ip: "198.51.100.9", userId: null, referer: "", userAgent: "Mozilla/5.0" },
        { db, send, siteUrl: SITE, inbox: "office@adams.example" },
      );
    // The two leads, and no outbox row.
    expect(inserted).toHaveLength(2);
  });
});
