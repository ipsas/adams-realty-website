import { CalendarDays, ChevronRight, Download, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { LeadAgentSelect, LeadStatusSelect } from "@/components/dashboard/lead-controls";
import { LeadTypeBadge, PageHeader, StatusDot, Table, Td, Th } from "@/components/dashboard/ui";
import { buttonClasses } from "@/components/ui/button";
import { site } from "@/config/site";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { getAgentOptions, getLeads } from "@/lib/dashboard/queries";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Leads" };

const tourLabel = (d: Date) =>
  d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: site.market.timeZone,
  });

const TABS = [
  ["", "Open"],
  ["new", "New"],
  ["contacted", "Contacted"],
  ["qualified", "Qualified"],
  ["closed", "Closed"],
  ["spam", "Spam"],
  ["all", "All"],
] as const;

export default async function LeadsPage(props: PageProps<"/dashboard/leads">) {
  const actor = await requirePermission("/dashboard/leads", can.viewDashboard);
  const { status, focus } = await props.searchParams;
  const current = TABS.some(([value]) => value === status) ? (status as string) : "";
  const [leads, agents] = await Promise.all([
    getLeads(actor, { status: current || undefined }),
    getAgentOptions(),
  ]);
  const admin = can.assignInquiry(actor);
  const tabLabel = TABS.find(([value]) => value === current)![1];

  return (
    <>
      <PageHeader
        title="Leads"
        description={
          admin
            ? "Every inquiry across the company. Unassigned leads need routing."
            : "Inquiries assigned to you."
        }
        action={
          can.viewAllInquiries(actor) ? (
            // A plain link: the route streams a file download, not a page.
            <a
              href={`/dashboard/leads/export?status=${current || "open"}`}
              download
              className={buttonClasses("secondary")}
              title={`Download ${current === "all" ? "all" : tabLabel.toLowerCase()} leads as a spreadsheet`}
            >
              <Download />
              Export CSV
            </a>
          ) : undefined
        }
      />
      <nav className="mb-5 flex flex-wrap gap-1" aria-label="Filter by status">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            href={value ? `/dashboard/leads?status=${value}` : "/dashboard/leads"}
            aria-current={current === value ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center rounded-full px-3.5 text-sm font-medium",
              current === value ? "bg-ink text-on-ink" : "text-ink-soft hover:bg-sunken",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      {leads.length === 0 ? (
        <p className="rounded-2xl bg-sunken px-5 py-10 text-center text-sm text-muted">
          Nothing here.
        </p>
      ) : (
        <>
          {/* Phones: one tappable card per lead; status and routing live on the lead page. */}
          <ul className="space-y-3 md:hidden">
            {leads.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/dashboard/leads/${l.id}`}
                  className={cn(
                    "block rounded-2xl border border-line bg-surface p-4 transition-colors active:bg-sunken",
                    focus === l.id && "border-brand-200 bg-brand-50/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{l.name}</p>
                      <p className="truncate text-xs text-muted">{l.email}</p>
                    </div>
                    <StatusDot status={l.status} />
                  </div>
                  <div className="mt-2.5 flex min-w-0 items-center gap-2">
                    <LeadTypeBadge type={l.type} />
                    {l.listingAddress && (
                      <span className="truncate text-sm text-ink-soft">{l.listingAddress}</span>
                    )}
                  </div>
                  {l.tourAt && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-brass-700">
                      <CalendarDays className="size-3.5" aria-hidden />
                      {tourLabel(l.tourAt)}
                      {l.tourType === "video" && " · video"}
                    </p>
                  )}
                  <div className="mt-2.5 flex items-center justify-between gap-3 text-xs text-muted">
                    <span className="truncate">
                      {formatRelative(l.createdAt)}
                      {admin && (
                        <>
                          {" · "}
                          {l.agentName ?? <span className="text-clay-600">Unassigned</span>}
                        </>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 tabular">
                      <MessageSquareText className="size-3.5" aria-hidden />
                      {l.notesCount} {l.notesCount === 1 ? "note" : "notes"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden md:block">
            <thead>
              <tr>
                <Th>Contact</Th>
                <Th>Request</Th>
                {admin && <Th>Agent</Th>}
                <Th>Status</Th>
                <Th>Received</Th>
                <Th>
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                // The whole row opens the lead (the name's link stretches over it);
                // links and selects inside sit above it with `relative z-10`.
                <tr
                  key={l.id}
                  className={cn(
                    "group relative transition-colors hover:bg-sunken/50",
                    focus === l.id && "bg-brand-50/60 hover:bg-brand-50",
                  )}
                >
                  <Td className="w-56">
                    <Link
                      href={`/dashboard/leads/${l.id}`}
                      className="font-medium text-ink group-hover:text-brand-700 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand-500"
                    >
                      {l.name}
                    </Link>
                    <a
                      href={`mailto:${l.email}`}
                      className="relative z-10 block w-fit text-xs hover:text-brand-700"
                    >
                      {l.email}
                    </a>
                    {l.phone && (
                      <a
                        href={`tel:${l.phone.replace(/\D/g, "")}`}
                        className="relative z-10 block w-fit text-xs hover:text-brand-700"
                      >
                        {l.phone}
                      </a>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <LeadTypeBadge type={l.type} />
                      {l.listingSlug && (
                        <Link
                          href={`/homes/${l.listingSlug}`}
                          className="relative z-10 text-xs font-medium text-ink hover:text-brand-700"
                        >
                          {l.listingAddress}
                        </Link>
                      )}
                    </div>
                    {l.tourAt && (
                      <p className="mt-1 flex items-center gap-1 text-xs whitespace-nowrap text-brass-700">
                        <CalendarDays className="size-3.5" />
                        {tourLabel(l.tourAt)}
                        {l.tourType === "video" && " · video"}
                      </p>
                    )}
                    {l.message && (
                      <p className="mt-1 line-clamp-2 max-w-md text-xs whitespace-pre-line">
                        {l.message}
                      </p>
                    )}
                  </Td>
                  {admin && (
                    <Td>
                      <div className="relative z-10 w-fit">
                        <LeadAgentSelect id={l.id} agentId={l.agentId} agents={agents} />
                      </div>
                    </Td>
                  )}
                  <Td>
                    <div className="relative z-10 w-fit">
                      <LeadStatusSelect id={l.id} status={l.status} />
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatRelative(l.createdAt)}
                    {l.notesCount > 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted tabular">
                        <MessageSquareText className="size-3.5" aria-hidden />
                        {l.notesCount} {l.notesCount === 1 ? "note" : "notes"}
                      </span>
                    )}
                  </Td>
                  <Td className="w-10 pr-3 pl-0">
                    <ChevronRight
                      className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700"
                      aria-hidden
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}
