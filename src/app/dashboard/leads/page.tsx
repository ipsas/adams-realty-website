import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { LeadAgentSelect, LeadStatusSelect } from "@/components/dashboard/lead-controls";
import { LeadTypeBadge, PageHeader, Table, Td, Th } from "@/components/dashboard/ui";
import { site } from "@/config/site";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { getAgentOptions, getLeads } from "@/lib/dashboard/queries";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Leads" };

const TABS = [
  ["", "Open"],
  ["new", "New"],
  ["contacted", "Contacted"],
  ["qualified", "Qualified"],
  ["closed", "Closed"],
  ["spam", "Spam"],
] as const;

export default async function LeadsPage(props: PageProps<"/dashboard/leads">) {
  const actor = await requirePermission("/dashboard/leads", can.viewDashboard);
  const { status, focus } = await props.searchParams;
  const current = typeof status === "string" ? status : "";
  const [leads, agents] = await Promise.all([
    getLeads(actor, { status: current || undefined }),
    getAgentOptions(),
  ]);
  const admin = can.assignInquiry(actor);

  return (
    <>
      <PageHeader
        title="Leads"
        description={
          admin
            ? "Every inquiry across the company. Unassigned leads need routing."
            : "Inquiries assigned to you."
        }
      />
      <nav className="mb-5 flex flex-wrap gap-1" aria-label="Filter by status">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            href={value ? `/dashboard/leads?status=${value}` : "/dashboard/leads"}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium",
              current === value ? "bg-ink text-white" : "text-ink-soft hover:bg-sunken",
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
        <Table>
          <thead>
            <tr>
              <Th>Contact</Th>
              <Th>Request</Th>
              {admin && <Th>Agent</Th>}
              <Th>Status</Th>
              <Th>Received</Th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className={cn(focus === l.id && "bg-brand-50/60")}>
                <Td className="w-64">
                  <p className="font-medium text-ink">{l.name}</p>
                  <a href={`mailto:${l.email}`} className="block text-xs hover:text-brand-700">
                    {l.email}
                  </a>
                  {l.phone && (
                    <a
                      href={`tel:${l.phone.replace(/\D/g, "")}`}
                      className="block text-xs hover:text-brand-700"
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
                        className="text-xs font-medium text-ink hover:text-brand-700"
                      >
                        {l.listingAddress}
                      </Link>
                    )}
                  </div>
                  {l.tourAt && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-brass-700">
                      <CalendarDays className="size-3.5" />
                      {l.tourAt.toLocaleString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: site.market.timeZone,
                      })}
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
                    <LeadAgentSelect id={l.id} agentId={l.agentId} agents={agents} />
                  </Td>
                )}
                <Td>
                  <LeadStatusSelect id={l.id} status={l.status} />
                </Td>
                <Td className="whitespace-nowrap">{formatRelative(l.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
