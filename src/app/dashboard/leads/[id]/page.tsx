import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  ExternalLink,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Video,
} from "lucide-react";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { LeadAgentSelect, LeadStatusSelect } from "@/components/dashboard/lead-controls";
import { LeadNotes, type LeadNoteItem } from "@/components/dashboard/lead-notes";
import { LeadTypeBadge, PageHeader, StatusDot } from "@/components/dashboard/ui";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { Label } from "@/components/ui/form";
import { Photo } from "@/components/ui/photo";
import { site } from "@/config/site";
import { can } from "@/lib/auth/permissions";
import { getSession, requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import {
  getAgentOptions,
  getContactActivity,
  getLead,
  getLeadNotes,
} from "@/lib/dashboard/queries";
import {
  formatBaths,
  formatCityLine,
  formatNumber,
  formatPrice,
  formatRelative,
  formatStreet,
  statusLabel,
} from "@/lib/format";
import {
  followUpGreeting,
  followUpSubject,
  formatLeadDateTime,
  LEAD_SOURCE_LABELS,
  LEAD_TYPE_LABELS,
  mailtoHref,
  refererPath,
  smsHref,
  telHref,
  TOUR_TYPE_LABELS,
} from "./lead-format";
import { canDeleteLeadNote } from "./note-policy";

// Static on purpose: a title built from the lead would put the contact's name
// on the 403 page an unauthorized agent sees.
export const metadata = { title: "Lead" };

const tz = site.market.timeZone;

export default async function LeadDetailPage(props: PageProps<"/dashboard/leads/[id]">) {
  const { id } = await props.params;
  const actor = await requirePermission(`/dashboard/leads/${id}`, can.viewDashboard);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  if (!can.viewInquiry(actor, lead)) forbidden();

  const admin = can.assignInquiry(actor);
  const [notes, activity, agents, session] = await Promise.all([
    getLeadNotes(id),
    getContactActivity(actor, lead.email, id),
    admin ? getAgentOptions() : Promise.resolve([]),
    getSession(),
  ]);

  const now = new Date();
  const noteItems: LeadNoteItem[] = notes.map((n) => ({
    id: n.id,
    body: n.body,
    authorName: n.authorName,
    createdAt: n.createdAt.toISOString(),
    relative: formatRelative(n.createdAt, now),
    absolute: formatLeadDateTime(n.createdAt, now),
    canDelete: canDeleteLeadNote(actor, lead, n),
  }));

  const tel = telHref(lead.phone);
  const sms = smsHref(lead.phone);
  const mailto = mailtoHref(lead.email, {
    subject: followUpSubject(lead),
    body: followUpGreeting(lead.name),
  });
  const listing = lead.listing;
  const canEditListing =
    !!listing &&
    can.editListing(actor, { sourceKind: listing.sourceKind, listAgentId: listing.listAgentId });
  const from = refererPath(lead.metadata.referer);
  const tourPassed = lead.tourAt ? lead.tourAt <= now : false;

  return (
    <>
      <Link
        href="/dashboard/leads"
        className="mb-3 -ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All leads
      </Link>
      <PageHeader
        title={lead.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <LeadTypeBadge type={lead.type} />
            <StatusDot status={lead.status} />
            <span>
              Received {formatRelative(lead.createdAt, now)}
              {listing && (
                <>
                  {" "}
                  about <span className="text-ink-soft">{formatStreet(listing)}</span>
                </>
              )}
            </span>
          </span>
        }
      />

      {/* Phones: contact and status first, then the request. Desktop: request and
          notes on the left, contact / status / home in a sidebar. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-1">
          <section
            aria-labelledby="contact-heading"
            className="rounded-2xl border border-line bg-surface p-5"
          >
            <h2 id="contact-heading" className="sr-only">
              Contact
            </h2>
            <div className="flex items-center gap-3">
              <Avatar
                src={null}
                name={lead.name}
                className="size-12 shrink-0 rounded-full text-lg"
              />
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{lead.name}</p>
                <p className="truncate text-sm text-ink-soft">{lead.email}</p>
                {lead.phone ? (
                  <p className="text-sm text-ink-soft tabular">{lead.phone}</p>
                ) : (
                  <p className="text-sm text-faint">No phone number given</p>
                )}
              </div>
            </div>
            <div className={cn("mt-4 grid gap-2", tel ? "grid-cols-3" : "grid-cols-1")}>
              {tel && sms && (
                <>
                  <ContactAction href={tel} icon={<Phone />} label="Call" />
                  <ContactAction href={sms} icon={<MessageSquare />} label="Text" />
                </>
              )}
              <ContactAction href={mailto} icon={<Mail />} label="Email" />
            </div>
            <p className="mt-3 text-xs text-muted">
              {lead.userId
                ? "Signed in when they sent this, so they have a saved-homes account."
                : "Sent as a guest (no account)."}
            </p>
          </section>

          <section
            aria-labelledby="routing-heading"
            className="space-y-4 rounded-2xl border border-line bg-surface p-5"
          >
            <h2 id="routing-heading" className="font-semibold text-ink">
              Lead status
            </h2>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-status">Status</Label>
              <LeadStatusSelect
                id={lead.id}
                status={lead.status}
                size="md"
                selectId="lead-status"
              />
            </div>
            {admin ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-agent">Assigned agent</Label>
                <LeadAgentSelect
                  id={lead.id}
                  agentId={lead.agentId}
                  agents={agents}
                  size="md"
                  selectId="lead-agent"
                />
                {!lead.agentId && (
                  <p className="text-xs text-clay-600">Unassigned: choose an agent to route it.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">
                Assigned to <span className="font-medium text-ink">you</span>. Your broker can
                reassign it.
              </p>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <section
            aria-labelledby="request-heading"
            className="rounded-2xl border border-line bg-surface"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4">
              <h2 id="request-heading" className="font-semibold text-ink">
                {LEAD_TYPE_LABELS[lead.type] ?? lead.type}
              </h2>
              <p className="text-xs text-muted">Lead #{lead.id.slice(0, 8)}</p>
            </header>

            {lead.tourAt && (
              <div className="flex items-center gap-4 border-b border-line bg-brass-100/40 px-5 py-4">
                <DateTile date={lead.tourAt} muted={tourPassed} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">
                    Requested tour
                  </p>
                  <p className="mt-0.5 font-semibold text-ink">
                    {formatLeadDateTime(lead.tourAt, now)}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-soft">
                    {lead.tourType === "video" ? (
                      <Video className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <CalendarDays className="size-4 shrink-0" aria-hidden />
                    )}
                    {TOUR_TYPE_LABELS[lead.tourType ?? "in_person"]}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                    tourPassed ? "bg-sunken text-muted" : "bg-brass-100 text-brass-700",
                  )}
                >
                  {tourPassed ? "Time has passed" : "Upcoming"}
                </span>
              </div>
            )}

            <div className="px-5 py-4">
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Message</h3>
              {lead.message ? (
                <p className="mt-1.5 leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line text-ink">
                  {lead.message}
                </p>
              ) : (
                <p className="mt-1.5 text-sm text-faint">No message. They only sent the form.</p>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-4 border-t border-line px-5 py-4 text-sm sm:grid-cols-3">
              <Detail label="Received">
                <time dateTime={lead.createdAt.toISOString()}>
                  {formatLeadDateTime(lead.createdAt, now)}
                </time>
              </Detail>
              <Detail label="Came from">
                {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
                {from && (
                  <span className="block truncate text-xs text-muted" title={from}>
                    {from}
                  </span>
                )}
              </Detail>
              <Detail label="Assigned agent">
                {lead.agentName ?? <span className="text-clay-600">Unassigned</span>}
              </Detail>
            </dl>
          </section>

          <LeadNotes
            inquiryId={lead.id}
            notes={noteItems}
            canAdd={can.updateInquiry(actor, lead)}
            viewerName={session?.user.name ?? "You"}
            offerMarkContacted={lead.status === "new"}
          />

          <section aria-labelledby="activity-heading">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="activity-heading" className="font-semibold text-ink">
                Other activity from this contact
              </h2>
              {!can.viewAllInquiries(actor) && (
                <p className="text-xs text-muted">Showing requests assigned to you</p>
              )}
            </div>
            {activity.length === 0 ? (
              <p className="rounded-2xl bg-sunken px-5 py-6 text-center text-sm text-muted">
                No other requests from {lead.email}.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {activity.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/dashboard/leads/${a.id}`}
                      className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-sunken/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <LeadTypeBadge type={a.type} />
                          <span className="truncate text-sm font-medium text-ink">
                            {a.listingAddress
                              ? `${a.listingAddress}, ${a.listingCity}`
                              : (LEAD_TYPE_LABELS[a.type] ?? a.type)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {formatRelative(a.createdAt, now)}
                          {a.tourAt && ` · Tour ${formatLeadDateTime(a.tourAt, now)}`}
                          {admin && ` · ${a.agentName ?? "Unassigned"}`}
                        </p>
                      </div>
                      <StatusDot status={a.status} />
                      <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {listing && (
          <section
            aria-labelledby="home-heading"
            className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface lg:col-start-2 lg:row-start-2"
          >
            <h2 id="home-heading" className="sr-only">
              The home
            </h2>
            <Photo
              src={listing.primaryPhotoUrl}
              alt={listing.hideAddress ? "The home" : formatStreet(listing)}
              sizes="(min-width: 1024px) 22rem, 100vw"
              className="aspect-[16/10] w-full"
            />
            <div className="p-5">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">
                {listing.removedAt
                  ? "No longer on the site"
                  : statusLabel(listing.status, listing.transactionType)}
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular">
                {formatPrice(listing.listPrice)}
                {listing.transactionType === "rent" && (
                  <span className="text-base font-normal text-muted">/mo</span>
                )}
              </p>
              <p className="mt-1 font-medium text-ink">
                {listing.unitNumber
                  ? `${listing.addressLine1} #${listing.unitNumber}`
                  : listing.addressLine1}
              </p>
              <p className="text-sm text-muted">{formatCityLine(listing)}</p>
              {(listing.bedrooms !== null || listing.livingAreaSqft !== null) && (
                <p className="mt-2 text-sm text-ink-soft tabular">
                  {[
                    listing.bedrooms !== null && `${listing.bedrooms} bd`,
                    listing.bathrooms !== null && `${formatBaths(listing.bathrooms)} ba`,
                    listing.livingAreaSqft !== null &&
                      `${formatNumber(listing.livingAreaSqft)} sqft`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {listing.hideAddress && (
                <p className="mt-2 text-xs text-muted">
                  The seller withheld this address from the public site.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {!listing.removedAt && (
                  <LinkButton
                    href={`/homes/${listing.slug}`}
                    variant="secondary"
                    size="md"
                    className="flex-1"
                  >
                    <ExternalLink />
                    Public page
                  </LinkButton>
                )}
                {canEditListing && (
                  <LinkButton
                    href={`/dashboard/listings/${listing.id}`}
                    variant="secondary"
                    size="md"
                    className="flex-1"
                  >
                    <Pencil />
                    Edit listing
                  </LinkButton>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function ContactAction({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <a
      href={href}
      className={buttonClasses(
        "subtle",
        "md",
        "h-auto min-h-16 flex-col gap-1 py-2.5 [&_svg]:size-5",
      )}
    >
      {icon}
      {label}
    </a>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-ink">{children}</dd>
    </div>
  );
}

/** Calendar-style month/day tile in the market's time zone. */
function DateTile({ date, muted }: { date: Date; muted: boolean }) {
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(date);
  return (
    <div
      aria-hidden
      className={cn(
        "flex w-14 shrink-0 flex-col items-center rounded-xl py-2",
        muted ? "bg-sunken text-muted" : "bg-surface text-brass-700 shadow-sm",
      )}
    >
      <span className="text-[0.6875rem] font-semibold tracking-wider uppercase">
        {part({ month: "short" })}
      </span>
      <span className={cn("text-xl leading-tight font-semibold tabular", !muted && "text-ink")}>
        {part({ day: "numeric" })}
      </span>
    </div>
  );
}
