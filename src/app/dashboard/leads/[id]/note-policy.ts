import { can, type Actor, type InquirySubject } from "@/lib/auth/permissions";

/** Longest note the form accepts and `addLeadNote` stores. */
export const MAX_NOTE_LENGTH = 4_000;

/**
 * Who may delete a lead note: its author or an admin, and only while they can
 * still work the lead (an agent loses a lead's notes when it's reassigned).
 * Adding notes is `can.updateInquiry`. Used by the page (to show the button)
 * and by `deleteLeadNote` (to enforce it).
 */
export function canDeleteLeadNote(
  actor: Actor | null,
  lead: InquirySubject,
  note: { authorId: string | null },
): boolean {
  if (!actor || !can.updateInquiry(actor, lead)) return false;
  return actor.role === "admin" || (note.authorId !== null && note.authorId === actor.userId);
}
