import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/permissions";
import { canDeleteLeadNote } from "./note-policy";

// Tests for src/server/actions/leads.ts (kept beside the page that uses them).
// The actions run against mocked Drizzle chains: each `select` resolves to the
// next queued result, each `update … returning` to the next queued update
// result, and inserts/updates/deletes are recorded.
const h = vi.hoisted(() => {
  const state = {
    actor: null as Actor | null,
    selects: [] as unknown[][],
    updates: [] as unknown[][],
    inserted: [] as Record<string, unknown>[],
    updated: [] as Record<string, unknown>[],
    deleted: 0,
    audits: [] as Record<string, unknown>[],
    revalidated: [] as string[],
  };
  function chain(result: unknown, onCall?: (method: string, args: unknown[]) => void) {
    const proxy: object = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then")
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(result).then(res, rej);
          return (...args: unknown[]) => {
            onCall?.(String(prop), args);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }
  const exec = {
    select: () => chain(state.selects.shift() ?? []),
    insert: () =>
      chain([{ id: "11111111-1111-4111-8111-111111111111" }], (m, args) => {
        if (m === "values") state.inserted.push(args[0] as Record<string, unknown>);
      }),
    update: () =>
      chain(state.updates.shift() ?? [], (m, args) => {
        if (m === "set") state.updated.push(args[0] as Record<string, unknown>);
      }),
    delete: () =>
      chain(undefined, (m) => {
        if (m === "where") state.deleted++;
      }),
  };
  return { state, exec };
});

vi.mock("@/db", () => ({
  db: { ...h.exec, transaction: (fn: (tx: typeof h.exec) => unknown) => fn(h.exec) },
}));
vi.mock("@/lib/auth/session", () => ({ getActor: async () => h.state.actor }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => h.state.revalidated.push(p),
}));
vi.mock("@/server/audit", () => ({
  audit: async (_tx: unknown, entry: Record<string, unknown>) => h.state.audits.push(entry),
}));

const { addLeadNote, deleteLeadNote } = await import("@/server/actions/leads");

const LEAD_ID = "91bb7b79-8a3e-4d3c-81e0-a85bdf032863";
const NOTE_ID = "446d8255-d590-45b8-9b34-8f00f91a922b";
const DANIEL = "3c35a2fa-1318-4963-bb42-42923d5e6a96";
const admin: Actor = { userId: "u-admin", role: "admin", agentId: null };
const daniel: Actor = { userId: "u-daniel", role: "agent", agentId: DANIEL };
const priya: Actor = { userId: "u-priya", role: "agent", agentId: "p" };
const shopper: Actor = { userId: "u-shopper", role: "user", agentId: null };

function noteForm(fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    inquiryId: LEAD_ID,
    body: "Called, left a voicemail.",
    ...fields,
  }))
    form.set(k, v);
  return form;
}

beforeEach(() => {
  Object.assign(h.state, {
    actor: daniel,
    selects: [],
    updates: [],
    inserted: [],
    updated: [],
    deleted: 0,
    audits: [],
    revalidated: [],
  });
});

describe("addLeadNote", () => {
  it("saves a trimmed note by the current user and audits it", async () => {
    h.state.selects = [[{ agentId: DANIEL }]];
    const res = await addLeadNote(
      { ok: true },
      noteForm({ body: "  Called, left a voicemail.  " }),
    );
    expect(res).toEqual({ ok: true, message: "Note added." });
    expect(h.state.inserted).toEqual([
      { inquiryId: LEAD_ID, authorId: "u-daniel", body: "Called, left a voicemail." },
    ]);
    expect(h.state.updated).toHaveLength(0);
    expect(h.state.audits).toEqual([
      {
        actorId: "u-daniel",
        action: "inquiry.note.add",
        entityType: "inquiry",
        entityId: LEAD_ID,
        changes: { noteId: "11111111-1111-4111-8111-111111111111" },
      },
    ]);
    expect(h.state.revalidated).toEqual(
      expect.arrayContaining([`/dashboard/leads/${LEAD_ID}`, "/dashboard/leads", "/dashboard"]),
    );
  });

  it("stores line breaks as LF, counting them once toward the limit", async () => {
    h.state.selects = [[{ agentId: DANIEL }], [{ agentId: DANIEL }]];
    await addLeadNote({ ok: true }, noteForm({ body: "Called.\r\nNo answer.\r\n" }));
    expect(h.state.inserted[0]).toMatchObject({ body: "Called.\nNo answer." });
    // 3,999 characters + one CRLF from the browser = 4,000 once normalized.
    const res = await addLeadNote({ ok: true }, noteForm({ body: `${"x".repeat(3_998)}\r\ny` }));
    expect(res.ok).toBe(true);
  });

  it("marks a new lead contacted when asked", async () => {
    h.state.selects = [[{ agentId: DANIEL }]];
    h.state.updates = [[{ id: LEAD_ID }]];
    const res = await addLeadNote({ ok: true }, noteForm({ markContacted: "on" }));
    expect(res).toEqual({ ok: true, message: "Note added and lead marked as contacted." });
    // The first reply is recorded too, kept if a status change already did (coalesce).
    expect(h.state.updated).toEqual([{ status: "contacted", firstContactedAt: expect.anything() }]);
    expect(h.state.audits[0]).toMatchObject({
      changes: { status: { from: "new", to: "contacted" } },
    });
  });

  it("leaves a lead that's no longer new alone", async () => {
    h.state.selects = [[{ agentId: DANIEL }]];
    // The conditional update (status = 'new') matched nothing.
    h.state.updates = [[]];
    const res = await addLeadNote({ ok: true }, noteForm({ markContacted: "on" }));
    expect(res).toEqual({ ok: true, message: "Note added." });
    expect(h.state.audits[0]).toMatchObject({ changes: { noteId: expect.any(String) } });
    expect(h.state.audits[0].changes).not.toHaveProperty("status");
  });

  it.each([
    ["   ", "Write a note first."],
    ["x".repeat(4_001), "Keep notes under 4,000 characters."],
  ])("rejects %j and hands the text back", async (body, error) => {
    h.state.selects = [[{ agentId: DANIEL }]];
    const res = await addLeadNote({ ok: true }, noteForm({ body }));
    expect(res).toEqual({ ok: false, error, body });
    expect(h.state.inserted).toHaveLength(0);
  });

  it("reports a bad or unknown lead id", async () => {
    expect(await addLeadNote({ ok: true }, noteForm({ inquiryId: "nope" }))).toEqual({
      ok: false,
      error: "Lead not found.",
    });
    h.state.selects = [[]];
    const res = await addLeadNote({ ok: true }, noteForm());
    expect(res).toMatchObject({ ok: false, error: "Lead not found." });
    expect(h.state.inserted).toHaveLength(0);
  });

  it("lets admins note any lead", async () => {
    h.state.actor = admin;
    h.state.selects = [[{ agentId: DANIEL }]];
    expect((await addLeadNote({ ok: true }, noteForm())).ok).toBe(true);
  });

  // Refusals come back as results (not throws) so the form keeps the text.
  it("refuses another agent's lead, handing the text back", async () => {
    h.state.actor = priya;
    h.state.selects = [[{ agentId: DANIEL }]];
    const res = await addLeadNote({ ok: true }, noteForm());
    expect(res).toEqual({
      ok: false,
      error: "This lead is no longer assigned to you, so the note wasn't saved.",
      body: "Called, left a voicemail.",
    });
    expect(h.state.inserted).toHaveLength(0);
    expect(h.state.audits).toHaveLength(0);
  });

  it("refuses shoppers and signed-out visitors, handing the text back", async () => {
    h.state.actor = shopper;
    expect(await addLeadNote({ ok: true }, noteForm())).toMatchObject({
      ok: false,
      error: "Your account can't add notes to leads.",
      body: "Called, left a voicemail.",
    });
    h.state.actor = null;
    expect(await addLeadNote({ ok: true }, noteForm())).toMatchObject({
      ok: false,
      error: expect.stringMatching(/session ended.*still here/),
      body: "Called, left a voicemail.",
    });
    expect(h.state.inserted).toHaveLength(0);
    expect(h.state.audits).toHaveLength(0);
  });
});

describe("deleteLeadNote", () => {
  const note = (over: Record<string, unknown> = {}) => ({
    inquiryId: LEAD_ID,
    authorId: "u-daniel",
    body: "Called, left a voicemail.",
    createdAt: new Date("2026-09-25T12:00:00Z"),
    agentId: DANIEL,
    ...over,
  });

  it("lets the author delete their note, keeping the text in the audit log", async () => {
    h.state.selects = [[note()]];
    const res = await deleteLeadNote(NOTE_ID, LEAD_ID);
    expect(res).toEqual({ ok: true, message: "Note deleted." });
    expect(h.state.deleted).toBe(1);
    expect(h.state.audits).toEqual([
      {
        actorId: "u-daniel",
        action: "inquiry.note.delete",
        entityType: "inquiry",
        entityId: LEAD_ID,
        changes: {
          noteId: NOTE_ID,
          authorId: "u-daniel",
          createdAt: "2026-09-25T12:00:00.000Z",
          body: "Called, left a voicemail.",
        },
      },
    ]);
    expect(h.state.revalidated).toContain(`/dashboard/leads/${LEAD_ID}`);
  });

  it("lets admins delete anyone's note", async () => {
    h.state.actor = admin;
    h.state.selects = [[note()]];
    expect((await deleteLeadNote(NOTE_ID, LEAD_ID)).ok).toBe(true);
  });

  const refused = { ok: false, message: "You can't delete this note." };

  it("refuses someone else's note, even on the agent's own lead", async () => {
    h.state.selects = [[note({ authorId: "u-admin" })]];
    expect(await deleteLeadNote(NOTE_ID, LEAD_ID)).toEqual(refused);
    expect(h.state.deleted).toBe(0);
    expect(h.state.audits).toHaveLength(0);
  });

  it("refuses an agent's old note once the lead is reassigned", async () => {
    h.state.selects = [[note({ agentId: "p" })]];
    expect(await deleteLeadNote(NOTE_ID, LEAD_ID)).toEqual(refused);
    expect(h.state.deleted).toBe(0);
  });

  it("refuses shoppers and signed-out visitors", async () => {
    h.state.actor = shopper;
    expect(await deleteLeadNote(NOTE_ID, LEAD_ID)).toEqual(refused);
    h.state.actor = null;
    expect(await deleteLeadNote(NOTE_ID, LEAD_ID)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/session ended/),
    });
    expect(h.state.deleted).toBe(0);
  });

  it("treats a note that's already gone as deleted and refreshes the lead", async () => {
    expect(await deleteLeadNote("nope", LEAD_ID)).toEqual({
      ok: false,
      message: "Note not found.",
    });
    h.state.selects = [[]];
    expect(await deleteLeadNote(NOTE_ID, LEAD_ID)).toEqual({
      ok: true,
      message: "That note was already deleted.",
    });
    expect(h.state.deleted).toBe(0);
    expect(h.state.audits).toHaveLength(0);
    expect(h.state.revalidated).toContain(`/dashboard/leads/${LEAD_ID}`);
  });

  it("doesn't revalidate an arbitrary path for a gone note", async () => {
    h.state.selects = [[]];
    await deleteLeadNote(NOTE_ID, "../../admin");
    expect(h.state.revalidated).toHaveLength(0);
  });
});

describe("canDeleteLeadNote", () => {
  const lead = { agentId: DANIEL };
  it("allows authors on their own leads and admins everywhere", () => {
    expect(canDeleteLeadNote(daniel, lead, { authorId: "u-daniel" })).toBe(true);
    expect(canDeleteLeadNote(admin, lead, { authorId: "u-daniel" })).toBe(true);
    expect(canDeleteLeadNote(admin, lead, { authorId: null })).toBe(true);
  });

  it("refuses everyone else", () => {
    expect(canDeleteLeadNote(daniel, lead, { authorId: "u-admin" })).toBe(false);
    expect(canDeleteLeadNote(daniel, lead, { authorId: null })).toBe(false);
    expect(canDeleteLeadNote(priya, lead, { authorId: "u-priya" })).toBe(false);
    expect(canDeleteLeadNote(shopper, lead, { authorId: "u-shopper" })).toBe(false);
    expect(canDeleteLeadNote(null, lead, { authorId: null })).toBe(false);
  });
});
