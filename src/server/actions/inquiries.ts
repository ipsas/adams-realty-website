"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { site } from "@/config/site";
import { db } from "@/db";
import { agents, inquiries, listings } from "@/db/schema";
import { toEmailListing } from "@/lib/alerts/present";
import { offersTours } from "@/lib/areas/firm-area";
import { inquiryReply, withoutTour } from "@/lib/inquiry-reply";
import { getSession } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email";
import { leadNotificationEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { formatCityLine, formatFullAddress, formatStreet } from "@/lib/format";
import { canShowDetails } from "@/lib/listings/visibility";
import { rateLimit } from "@/lib/rate-limit";
import { zonedDateTime } from "@/lib/time";

/** The thank-you for a listing problem report. */
const REPORT_REPLY = `Thanks — your report went to the ${site.name} office. We correct or remove wrong listing information within one business day.`;

export type InquiryState = {
  ok: boolean;
  message?: string;
  errors?: Partial<Record<string, string>>;
};

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
  // Honeypot: real people never see or fill this field.
  website: z.string().max(0).optional(),
});

/**
 * Public lead form handler (tour requests, questions, valuations). Leads are
 * routed to the listing agent, the chosen agent, or the brokerage inbox — and
 * never shared outside the company. A home outside the firm's area (and not
 * its own listing) takes questions only, answered by the office: a tour
 * request for one is saved as a question, with no tour time.
 */
export async function createInquiry(_prev: InquiryState, form: FormData): Promise<InquiryState> {
  const raw = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === "website")) return { ok: true }; // bot — pretend success
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, errors, message: "Please check the highlighted fields." };
  }
  const d = parsed.data;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // Generous outside production so local testing and e2e runs don't trip it.
  const limit = process.env.NODE_ENV === "production" ? 5 : 500;
  if (!rateLimit(`inquiry:${ip}`, limit, 10 * 60_000)) {
    return {
      ok: false,
      message: "You've sent several messages in a row — please try again in a few minutes.",
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
    // Georgia MLS rules keep hidden feed listings off the site, so no leads on them either
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
  const session = await getSession();

  const message =
    [d.message, d.notes, d.address && `Property address: ${d.address}`]
      .filter(Boolean)
      .join("\n\n") || null;
  const [row] = await db
    .insert(inquiries)
    .values({
      type: d.type,
      source: d.source,
      listingId: listing?.id ?? null,
      agentId: agent?.id ?? null,
      userId: session?.user.id ?? null,
      name: d.name,
      email: d.email,
      phone: d.phone ?? null,
      message,
      tourAt,
      tourType: d.type === "tour" ? (d.tourType ?? "in_person") : null,
      metadata: {
        referer: h.get("referer") ?? "",
        userAgent: (h.get("user-agent") ?? "").slice(0, 200),
      },
    })
    .returning({ id: inquiries.id });

  // Notify without failing the request if email is down — the lead is already saved.
  const to = report ? site.mls.corrections.email : (agent?.email ?? env.LEADS_INBOX ?? site.email);
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
    dashboardUrl: `${env.NEXT_PUBLIC_SITE_URL}/dashboard/leads?focus=${row.id}`,
    assignedAgentName: agent?.name ?? null,
  });
  sendEmail({
    to,
    replyTo: d.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  }).catch((e) => console.error("[inquiry] notification failed", e));

  return {
    ok: true,
    message: report ? REPORT_REPLY : inquiryReply(d, agent?.name ?? null, outOfArea),
  };
}
