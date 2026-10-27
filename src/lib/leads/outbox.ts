import { eq } from "drizzle-orm";
import { site } from "@/config/site";
import { db as defaultDb, type Executor } from "@/db";
import { agents, inquiries, listings, users } from "@/db/schema";
import { displayAgentEmail } from "@/lib/agents/display-email";
import { sendEmail, type Email, type SendEmail } from "@/lib/email";
import { processEmailOutbox, type OutboxRow, type OutboxRun } from "@/lib/email-outbox";
import { leadNotificationEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { emailSettingsUrl, leadAssignedEmail, leadEmailInput } from "./notify";

/**
 * Rebuilds a queued lead notice (src/lib/email-outbox.ts) from the lead and
 * recipient as they are now, with the same idempotency key as the first try
 * where it had a stable one. Null (the row is dropped) when the lead is gone
 * or now marked spam, or the recipient is gone, no longer the lead's agent,
 * no longer an admin who wants copies, or has no email.
 *
 * The visitor gets no copy of their own lead, so there is no 'lead' role. A
 * rebuilt lead notice shows the stored message, where a valuation's address
 * is a line of its own ("Property address: …"), as the assignment email does.
 * A rebuilt assignment notice names no admin ("Your broker assigned…"): who
 * assigned it isn't stored.
 */
export async function rebuildLeadEmail(
  deps: { db: Executor; siteUrl: string; inbox: string },
  row: OutboxRow,
): Promise<Email | null> {
  if (row.kind === "lead-assignment") {
    if (!row.recipientId) return null;
    return leadAssignedEmail(deps, {
      inquiryId: row.entityId,
      agentId: row.recipientId,
      assignedBy: { userId: "", name: null },
      at: row.createdAt,
    });
  }
  const [found] = await deps.db
    .select({ lead: inquiries, listing: listings, agent: agents })
    .from(inquiries)
    .leftJoin(agents, eq(agents.id, inquiries.agentId))
    .leftJoin(listings, eq(inquiries.listingId, listings.id))
    .where(eq(inquiries.id, row.entityId))
    .limit(1);
  if (!found || found.lead.status === "spam") return null;
  const { lead, listing, agent } = found;
  const input = leadEmailInput({
    id: lead.id,
    type: lead.type,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    message: lead.message,
    tourAt: lead.tourAt,
    tourType: lead.tourType,
    source: lead.source,
    listing,
    agentName: agent?.name ?? null,
    siteUrl: deps.siteUrl,
  });

  if (row.kind === "lead-copy") {
    if (!row.recipientId) return null;
    const [admin] = await deps.db
      .select({ id: users.id, email: users.email, role: users.role, leadCopies: users.leadCopies })
      .from(users)
      .where(eq(users.id, row.recipientId))
      .limit(1);
    if (!admin?.email || admin.role !== "admin" || !admin.leadCopies) return null;
    if (agent?.userId === admin.id) return null;
    const copy = leadNotificationEmail({
      ...input,
      audience: "copy",
      settingsUrl: emailSettingsUrl(deps.siteUrl),
    });
    return {
      kind: "lead-copy",
      to: admin.email,
      replyTo: lead.email,
      subject: copy.subject,
      text: copy.text,
      html: copy.html,
      idempotencyKey: `lead-copy:${lead.id}:${admin.id}`,
    };
  }

  const to =
    row.recipientRole === "agent"
      ? agent && agent.id === row.recipientId
        ? displayAgentEmail(agent)
        : null
      : row.recipientRole === "office"
        ? deps.inbox
        : row.recipientRole === "corrections"
          ? site.mls.corrections.email
          : null;
  if (!to) return null;
  const main = leadNotificationEmail(input);
  return {
    kind: "lead-notice",
    to,
    replyTo: lead.email,
    subject: main.subject,
    text: main.text,
    html: main.html,
    idempotencyKey: `lead-new:${lead.id}`,
  };
}

/** The sync cron's outbox step: queued lead notices, each sent once (`sendEmail`). */
export function retryLeadEmails(
  opts: { db?: Executor; send?: SendEmail; siteUrl?: string; inbox?: string } = {},
): Promise<OutboxRun> {
  const db = opts.db ?? defaultDb;
  const deps = {
    db,
    siteUrl: opts.siteUrl ?? env.NEXT_PUBLIC_SITE_URL,
    inbox: opts.inbox ?? env.LEADS_INBOX ?? site.email,
  };
  return processEmailOutbox({
    db,
    send: opts.send ?? sendEmail,
    rebuild: (row) => rebuildLeadEmail(deps, row),
  });
}
