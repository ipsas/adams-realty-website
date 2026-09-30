import { eq } from "drizzle-orm";
import { z } from "zod";
import { site } from "@/config/site";
import type { Executor } from "@/db";
import { agents, inquiries, listings } from "@/db/schema";
import { toEmailListing } from "@/lib/alerts/present";
import { offersTours } from "@/lib/areas/firm-area";
import type { Email } from "@/lib/email";
import { leadNotificationEmail } from "@/lib/email-templates";
import { hitFormLimits, isKnownCustomer, retryPhrase } from "@/lib/form-guard";
import { formatCityLine, formatFullAddress, formatStreet } from "@/lib/format";
import { inquiryReply, withoutTour } from "@/lib/inquiry-reply";
import { canShowDetails } from "@/lib/listings/visibility";
import {
  ELAPSED_FIELD,
  formSignals,
  HONEYPOT_FIELD,
  isSeoPitch,
  MIN_FILL_MS,
  type SpamReason,
} from "@/lib/spam";
import { zonedDateTime } from "@/lib/time";

/**
 * Public lead forms (tour requests, questions, valuations, listing problem
 * reports): validation, spam checks, storage and the notification email.
 * `createInquiry` (src/server/actions/inquiries.ts) calls it with the
 * request's details; tests call it with their own database and mailer.
 *
 * Leads are routed to the listing agent, the chosen agent, or the brokerage
 * inbox, and never shared outside the company. A home outside the firm's
 * area (and not its own listing) takes questions only, answered by the
 * office: a tour request for one is saved as a question, with no tour time.
 *
 * Spam (src/lib/spam.ts): over a submission limit, the sender is told to wait
 * and nothing is stored. Suspected spam (the honeypot, sent too fast or not
 * from the page, an SEO pitch from a non-customer) is stored with status
 * `spam` and its reasons in `metadata.spam`, unassigned (the agent it would
 * have gone to is kept in `metadata.routedAgentId`), and never emailed. The
 * sender sees the usual thank-you, so robots learn nothing.
 */

export type InquiryState = {
  ok: boolean;
  message?: string;
  errors?: Partial<Record<string, string>>;
};

/** The thank-you for a listing problem report. */
const REPORT_REPLY = `Thanks — your report went to the ${site.name} office. We correct or remove wrong listing information within one business day.`;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const schema = z.object({
  type: z.enum(["question", "tour", "offer", "valuation", "general"]),
  source: z.enum(["listing", "sell", "agent", "contact", "report"]),
  listingId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  agentId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(2, "Please enter your name").max(100),
  email: z.string().trim().email("Please enter a valid email").max(200),
  phone: optionalText(40),
  message: optionalText(4000),
  notes: optionalText(4000),
  address: optionalText(300),
  tourDate: optionalText(10),
  tourTime: optionalText(5),
  tourType: z.enum(["in_person", "video"]).optional(),
});

export type SubmitContext = {
  ip: string | null;
  userId: string | null;
  referer: string;
  userAgent: string;
};

export type SubmitDeps = {
  db: Executor;
  send: (email: Email) => Promise<void>;
  siteUrl: string;
  /** Where unassigned leads are emailed (LEADS_INBOX, else the firm's inbox). */
  inbox: string;
  production?: boolean;
  now?: Date;
};

export type SubmitResult = InquiryState & { id?: string; spam?: SpamReason[] };

export async function submitInquiry(
  raw: Record<string, string>,
  ctx: SubmitContext,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const { db } = deps;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, errors, message: "Please check the highlighted fields." };
  }
  const d = parsed.data;

  const limited = await hitFormLimits(
    db,
    "inquiry",
    { ip: ctx.ip, email: d.email },
    { production: deps.production, now: deps.now },
  );
  if (!limited.ok) {
    return {
      ok: false,
      message: `You've sent several messages in a row. Please try again in ${retryPhrase(limited.retryAfter)}, or call us at ${site.phone}.`,
    };
  }

  // A listing problem report (/listing-corrections) goes to the office's
  // corrections contact, never to an agent, and is never a tour.
  const report = d.source === "report";
  if (report) Object.assign(d, { type: "question" as const, agentId: undefined });
  let agentId = d.agentId ?? null;
  let listing: typeof listings.$inferSelect | undefined;
  let outOfArea = false;
  if (d.listingId) {
    [listing] = await db.select().from(listings).where(eq(listings.id, d.listingId)).limit(1);
    if (!listing) return { ok: false, message: "That home is no longer available." };
    // Hidden-status listings (feed or the firm's own) are off the site, so no leads on them either
    // (a problem report about one still reaches the office).
    if (!report && !canShowDetails(listing))
      return { ok: false, message: "That home is no longer available." };
    if (!report) agentId ??= listing.listAgentId;
    outOfArea = !offersTours(listing);
    Object.assign(d, withoutTour(d, !outOfArea && !report));
  }
  const [agent] = agentId
    ? await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
    : [];

  const tourAt =
    d.type === "tour" && d.tourDate && d.tourTime ? zonedDateTime(d.tourDate, d.tourTime) : null;
  const message =
    [d.message, d.notes, d.address && `Property address: ${d.address}`]
      .filter(Boolean)
      .join("\n\n") || null;

  const spam = formSignals({
    honeypot: raw[HONEYPOT_FIELD],
    elapsed: raw[ELAPSED_FIELD],
    minMs: MIN_FILL_MS.message,
  });
  if (isSeoPitch(message) && !(await isKnownCustomer(db, d.email, ctx.userId)))
    spam.push("seo-pitch");
  const suspected = spam.length > 0;

  const [row] = await db
    .insert(inquiries)
    .values({
      type: d.type,
      source: d.source,
      status: suspected ? "spam" : "new",
      listingId: listing?.id ?? null,
      // Suspected spam reaches no agent; an admin who clears it gets the routing back.
      agentId: suspected ? null : (agent?.id ?? null),
      userId: ctx.userId,
      name: d.name,
      email: d.email,
      phone: d.phone ?? null,
      message,
      tourAt,
      tourType: d.type === "tour" ? (d.tourType ?? "in_person") : null,
      metadata: {
        referer: ctx.referer,
        userAgent: ctx.userAgent.slice(0, 200),
        ...(suspected ? { spam: spam.join(","), routedAgentId: agent?.id ?? "" } : {}),
      },
    })
    .returning({ id: inquiries.id });

  const reply = report ? REPORT_REPLY : inquiryReply(d, agent?.name ?? null, outOfArea);
  if (suspected) return { ok: true, message: reply, id: row.id, spam };

  // Notify without failing the request if email is down — the lead is already saved.
  const to = report ? site.mls.corrections.email : (agent?.email ?? deps.inbox);
  const subject = report
    ? `Listing problem report: ${listing ? formatFullAddress(listing) : "a listing"}`
    : d.type === "tour"
      ? `Tour request: ${listing ? formatFullAddress(listing) : "a home"}`
      : d.type === "valuation"
        ? "New home valuation request"
        : `New ${d.type} from ${d.name}`;
  const email = leadNotificationEmail({
    subject,
    type: d.type,
    name: d.name,
    email: d.email,
    phone: d.phone,
    // Their own words; the valuation address gets its own row.
    message: [d.message, d.notes].filter(Boolean).join("\n\n") || null,
    propertyAddress: d.address,
    tourLabel: tourAt
      ? tourAt.toLocaleString("en-US", {
          timeZone: site.market.timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : null,
    tourType: d.type === "tour" ? (d.tourType ?? "in_person") : null,
    listing: listing ? toEmailListing(listing) : null,
    listingPlace: listing
      ? listing.hideAddress
        ? `a home in ${formatCityLine(listing)}`
        : formatStreet(listing)
      : null,
    source: d.source,
    dashboardUrl: `${deps.siteUrl}/dashboard/leads?focus=${row.id}`,
    assignedAgentName: agent?.name ?? null,
  });
  await deps
    .send({ to, replyTo: d.email, subject: email.subject, text: email.text, html: email.html })
    .catch((e) => console.error("[inquiry] notification failed", e));

  return { ok: true, message: reply, id: row.id, spam: [] };
}
