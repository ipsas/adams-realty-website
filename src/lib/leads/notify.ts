import { and, eq } from "drizzle-orm";
import { site } from "@/config/site";
import type { Executor } from "@/db";
import { agents, inquiries, listings, users } from "@/db/schema";
import { displayAgentEmail } from "@/lib/agents/display-email";
import { toEmailListing } from "@/lib/alerts/present";
import type { Email } from "@/lib/email";
import { leadNotificationEmail } from "@/lib/email-templates";
import { formatCityLine, formatFullAddress, formatStreet } from "@/lib/format";

/**
 * Lead notification emails (site review #3):
 *
 * - A new lead goes to its agent, or to the office inbox when it has none;
 *   a listing problem report goes to the corrections contact.
 * - Every admin with "Copy me on every new lead" on (`users.lead_copies`,
 *   on by default: owner decision) gets a copy of each new lead, unless it
 *   already went to them. Reports and suspected spam are not leads and get
 *   no copies.
 * - When an admin assigns or reassigns a lead, the agent it now belongs to is
 *   emailed (not when they assign it to themselves).
 *
 * Every email's button opens the lead itself (/dashboard/leads/<id>), where
 * the Call and Text buttons are. Sending is the caller's `send`; server
 * actions run it after the response with `after()` (./deliver.ts) so a
 * serverless function isn't stopped mid-send.
 */

export type LeadMailDeps = {
  db: Executor;
  send: (email: Email) => Promise<void>;
  /** Absolute origin for links, e.g. https://adamsrealtyga.com. */
  siteUrl: string;
};

export const leadPageUrl = (siteUrl: string, id: string) => `${siteUrl}/dashboard/leads/${id}`;
export const emailSettingsUrl = (siteUrl: string) => `${siteUrl}/dashboard/settings`;

type ListingRow = typeof listings.$inferSelect;
type LeadEmailInput = Parameters<typeof leadNotificationEmail>[0];

/** The subject line for a lead's email. */
export function leadSubject(input: {
  type: string;
  name: string;
  source: string;
  listing: ListingRow | null;
}): string {
  const { listing } = input;
  if (input.source === "report")
    return `Listing problem report: ${listing ? formatFullAddress(listing) : "a listing"}`;
  if (input.type === "tour")
    return `Tour request: ${listing ? formatFullAddress(listing) : "a home"}`;
  if (input.type === "valuation") return "New home valuation request";
  return `New ${input.type} from ${input.name}`;
}

/** A tour time as the email shows it, in the market's time zone. */
export function tourLabel(tourAt: Date | null): string | null {
  return tourAt
    ? tourAt.toLocaleString("en-US", {
        timeZone: site.market.timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : null;
}

/** Everything the lead email shows, from the lead's details. */
export function leadEmailInput(input: {
  id: string;
  type: LeadEmailInput["type"];
  name: string;
  email: string;
  phone: string | null;
  /** Their own words (the valuation address has its own row). */
  message: string | null;
  propertyAddress?: string | null;
  tourAt: Date | null;
  tourType: "in_person" | "video" | null;
  source: string;
  listing: ListingRow | null;
  agentName: string | null;
  siteUrl: string;
}): LeadEmailInput {
  const { listing } = input;
  return {
    subject: leadSubject(input),
    type: input.type,
    name: input.name,
    email: input.email,
    phone: input.phone,
    message: input.message,
    propertyAddress: input.propertyAddress ?? null,
    tourLabel: tourLabel(input.tourAt),
    tourType: input.type === "tour" ? (input.tourType ?? "in_person") : null,
    listing: listing ? toEmailListing(listing) : null,
    listingPlace: listing
      ? listing.hideAddress
        ? `a home in ${formatCityLine(listing)}`
        : formatStreet(listing)
      : null,
    source: input.source,
    dashboardUrl: leadPageUrl(input.siteUrl, input.id),
    assignedAgentName: input.agentName,
  };
}

/** Admins who want a copy of every new lead. */
export async function leadCopyRecipients(db: Executor) {
  return db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.leadCopies, true)));
}

const norm = (email: string) => email.trim().toLowerCase();

/** Sends one email, logging (not throwing) a failure so the others still go out. */
async function trySend(send: LeadMailDeps["send"], email: Email, what: string): Promise<boolean> {
  try {
    await send(email);
    return true;
  } catch (e) {
    console.error(`[leads] ${what} failed`, e);
    return false;
  }
}

/**
 * A new lead's emails: the main one to `to` (its agent, the office inbox, or
 * the corrections contact for a report), then the admins' copies. Returns the
 * addresses emailed.
 */
export async function sendNewLeadEmails(
  deps: LeadMailDeps,
  lead: {
    id: string;
    input: LeadEmailInput;
    to: string;
    replyTo: string;
    /** The login of the agent it went to, if any: that admin already has it. */
    agentUserId: string | null;
    /** Listing problem reports aren't leads: no copies. */
    copies: boolean;
  },
): Promise<string[]> {
  const sent: string[] = [];
  const main = leadNotificationEmail(lead.input);
  if (
    await trySend(
      deps.send,
      {
        to: lead.to,
        replyTo: lead.replyTo,
        subject: main.subject,
        text: main.text,
        html: main.html,
        idempotencyKey: `lead-new:${lead.id}`,
      },
      "lead notification",
    )
  )
    sent.push(lead.to);
  if (!lead.copies) return sent;

  const done = new Set([norm(lead.to)]);
  for (const admin of await leadCopyRecipients(deps.db)) {
    if (admin.userId === lead.agentUserId || done.has(norm(admin.email))) continue;
    done.add(norm(admin.email));
    const copy = leadNotificationEmail({
      ...lead.input,
      audience: "copy",
      settingsUrl: emailSettingsUrl(deps.siteUrl),
    });
    if (
      await trySend(
        deps.send,
        {
          to: admin.email,
          replyTo: lead.replyTo,
          subject: copy.subject,
          text: copy.text,
          html: copy.html,
          idempotencyKey: `lead-copy:${lead.id}:${admin.userId}`,
        },
        "lead copy",
      )
    )
      sent.push(admin.email);
  }
  return sent;
}

/**
 * Tells an agent a lead was assigned to them. `assignedBy` is the admin who did
 * it (no email when they assigned it to themselves). Reads the lead fresh, so
 * the email shows what the agent will find. Returns the address emailed, or
 * null when nobody was.
 */
export async function sendLeadAssignedEmail(
  deps: LeadMailDeps,
  input: {
    inquiryId: string;
    agentId: string;
    assignedBy: { userId: string; name: string | null };
    /** Distinguishes repeat assignments in the idempotency key. */
    at?: Date;
  },
): Promise<string | null> {
  const [row] = await deps.db
    .select({ lead: inquiries, listing: listings, agent: agents })
    .from(inquiries)
    .innerJoin(agents, eq(agents.id, input.agentId))
    .leftJoin(listings, eq(inquiries.listingId, listings.id))
    .where(eq(inquiries.id, input.inquiryId))
    .limit(1);
  if (!row || row.lead.agentId !== input.agentId) return null;
  if (row.agent.userId && row.agent.userId === input.assignedBy.userId) return null;
  const { lead, listing, agent } = row;
  const to = displayAgentEmail(agent);
  const email = leadNotificationEmail({
    ...leadEmailInput({
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
      agentName: agent.name,
      siteUrl: deps.siteUrl,
    }),
    audience: "assigned",
    assignedByName: input.assignedBy.name,
  });
  const ok = await trySend(
    deps.send,
    {
      to,
      replyTo: lead.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: `lead-assign:${lead.id}:${agent.id}:${(input.at ?? new Date()).toISOString()}`,
    },
    "lead assignment email",
  );
  return ok ? to : null;
}
