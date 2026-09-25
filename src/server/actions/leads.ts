"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canDeleteLeadNote, MAX_NOTE_LENGTH } from "@/app/dashboard/leads/[id]/note-policy";
import { db } from "@/db";
import { inquiries, leadNotes } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";
import { audit } from "../audit";

// Private notes staff keep on a lead (calls, showings, next steps). Whoever may
// update the lead (its agent or an admin) can add notes; authors delete their
// own and admins any (see note-policy.ts).
//
// Status: while a lead is still "new", the note form offers "Mark as
// contacted" (checked by default), because logging the first call or email is
// usually the moment a lead stops being new. Unchecking it just saves the note.
// A lead that has moved past "new" is never changed by adding a note.
//
// Refusals a user can hit while the page is open (the session ended, the lead
// was reassigned) come back as results rather than thrown errors: a throw would
// reach the error boundary and take the half-written note with it.

export type LeadNoteState = {
  ok: boolean;
  message?: string;
  error?: string;
  /** What was submitted, returned on failure so the form can keep the text. */
  body?: string;
};

export type DeleteLeadNoteResult = { ok: boolean; message?: string };

const SESSION_ENDED = "Your session ended. Sign in again in another tab, then save.";

const noteSchema = z.object({
  inquiryId: z.string().uuid(),
  body: z
    .string()
    // Browsers submit textarea line breaks as CRLF; store (and count) them as LF.
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .min(1, "Write a note first.")
        .max(
          MAX_NOTE_LENGTH,
          `Keep notes under ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters.`,
        ),
    ),
  markContacted: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

function revalidateLead(inquiryId: string) {
  revalidatePath(`/dashboard/leads/${inquiryId}`);
  // The list shows note counts; the overview shows statuses.
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard");
}

export async function addLeadNote(_prev: LeadNoteState, form: FormData): Promise<LeadNoteState> {
  const raw = {
    inquiryId: form.get("inquiryId"),
    body: form.get("body") ?? "",
    markContacted: form.get("markContacted") ?? undefined,
  };
  const body = typeof raw.body === "string" ? raw.body : "";
  const actor = await getActor();
  if (!actor) return { ok: false, error: `${SESSION_ENDED} Your note is still here.`, body };
  if (!can.viewDashboard(actor))
    return { ok: false, error: "Your account can't add notes to leads.", body };
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue.path[0] === "inquiryId") return { ok: false, error: "Lead not found." };
    return { ok: false, error: issue.message, body };
  }
  const d = parsed.data;

  const [lead] = await db
    .select({ agentId: inquiries.agentId })
    .from(inquiries)
    .where(eq(inquiries.id, d.inquiryId))
    .limit(1);
  if (!lead) return { ok: false, error: "Lead not found.", body };
  if (!can.updateInquiry(actor, lead))
    return {
      ok: false,
      error: "This lead is no longer assigned to you, so the note wasn't saved.",
      body,
    };

  const markedContacted = await db.transaction(async (tx) => {
    const [note] = await tx
      .insert(leadNotes)
      .values({ inquiryId: d.inquiryId, authorId: actor.userId, body: d.body })
      .returning({ id: leadNotes.id });
    // Conditional on "new" so a status someone else just set is never overwritten.
    const advanced = d.markContacted
      ? await tx
          .update(inquiries)
          .set({ status: "contacted" })
          .where(and(eq(inquiries.id, d.inquiryId), eq(inquiries.status, "new")))
          .returning({ id: inquiries.id })
      : [];
    await audit(tx, {
      actorId: actor.userId,
      action: "inquiry.note.add",
      entityType: "inquiry",
      entityId: d.inquiryId,
      changes: {
        noteId: note.id,
        ...(advanced.length > 0 && { status: { from: "new", to: "contacted" } }),
      },
    });
    return advanced.length > 0;
  });

  revalidateLead(d.inquiryId);
  return {
    ok: true,
    message: markedContacted ? "Note added and lead marked as contacted." : "Note added.",
  };
}

/**
 * `inquiryId` is the lead the page shows. It's only used to refresh that page
 * when the note is already gone (deleted in another tab or by an admin), so the
 * stale copy disappears instead of lingering beside an error.
 */
export async function deleteLeadNote(
  noteId: string,
  inquiryId: string,
): Promise<DeleteLeadNoteResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  if (!can.viewDashboard(actor)) return { ok: false, message: "You can't delete this note." };
  const uuid = z.string().uuid();
  if (!uuid.safeParse(noteId).success) return { ok: false, message: "Note not found." };

  const [row] = await db
    .select({
      inquiryId: leadNotes.inquiryId,
      authorId: leadNotes.authorId,
      body: leadNotes.body,
      createdAt: leadNotes.createdAt,
      agentId: inquiries.agentId,
    })
    .from(leadNotes)
    .innerJoin(inquiries, eq(leadNotes.inquiryId, inquiries.id))
    .where(eq(leadNotes.id, noteId))
    .limit(1);
  if (!row) {
    // Deleting is idempotent: the note is gone either way.
    if (uuid.safeParse(inquiryId).success) revalidateLead(inquiryId);
    return { ok: true, message: "That note was already deleted." };
  }
  if (!canDeleteLeadNote(actor, { agentId: row.agentId }, { authorId: row.authorId }))
    return { ok: false, message: "You can't delete this note." };

  await db.transaction(async (tx) => {
    await tx.delete(leadNotes).where(eq(leadNotes.id, noteId));
    // The text is kept in the audit log so an admin can recover a note deleted by mistake.
    await audit(tx, {
      actorId: actor.userId,
      action: "inquiry.note.delete",
      entityType: "inquiry",
      entityId: row.inquiryId,
      changes: {
        noteId,
        authorId: row.authorId,
        createdAt: row.createdAt.toISOString(),
        body: row.body,
      },
    });
  });

  revalidateLead(row.inquiryId);
  return { ok: true, message: "Note deleted." };
}
