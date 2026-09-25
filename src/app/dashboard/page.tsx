import Link from "next/link";
import {
  LeadTypeBadge,
  PageHeader,
  StatCard,
  StatusDot,
  Table,
  Td,
  Th,
} from "@/components/dashboard/ui";
import { LinkButton } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getOverview } from "@/lib/dashboard/queries";
import { formatPriceShort, formatRelative } from "@/lib/format";

export const metadata = { title: "Overview" };

export default async function DashboardHome() {
  const actor = await requirePermission("/dashboard", can.viewDashboard);
  const { listingStats, leadStats, saves, recentLeads } = await getOverview(actor);
  const admin = actor.role === "admin";
  return (
    <>
      <PageHeader
        title="Overview"
        description={
          admin
            ? "Company-wide activity across every Adams Realty listing."
            : "Your listings and leads at a glance."
        }
        action={
          can.createListing(actor) ? (
            <LinkButton href="/dashboard/listings/new">New listing</LinkButton>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active listings"
          value={listingStats.active}
          hint={`${listingStats.pending} under contract`}
        />
        <StatCard
          label="Active volume"
          value={formatPriceShort(Number(listingStats.volume))}
          hint="List price, for-sale only"
        />
        <StatCard
          label="New leads"
          value={leadStats.newLeads}
          hint={`${leadStats.thisWeek} in the last 7 days`}
        />
        <StatCard
          label="Saves (30 days)"
          value={saves}
          hint={`${leadStats.tours} upcoming tour requests`}
        />
      </div>

      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Latest leads</h2>
        <Link
          href="/dashboard/leads"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          View all
        </Link>
      </div>
      {recentLeads.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Contact</Th>
              <Th>Type</Th>
              <Th>Home</Th>
              {admin && <Th>Agent</Th>}
              <Th>Status</Th>
              <Th>Received</Th>
            </tr>
          </thead>
          <tbody>
            {recentLeads.map((l) => (
              <tr key={l.id}>
                <Td>
                  <p className="font-medium text-ink">{l.name}</p>
                  <p className="text-xs">{l.email}</p>
                </Td>
                <Td>
                  <LeadTypeBadge type={l.type} />
                </Td>
                <Td>
                  {l.listingSlug ? (
                    <Link href={`/homes/${l.listingSlug}`} className="hover:text-brand-700">
                      {l.listingAddress}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Td>
                {admin && (
                  <Td>{l.agentName ?? <span className="text-clay-600">Unassigned</span>}</Td>
                )}
                <Td>
                  <StatusDot status={l.status} />
                </Td>
                <Td>{formatRelative(l.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="rounded-2xl bg-sunken px-5 py-8 text-center text-sm text-muted">
          No open leads right now.
        </p>
      )}
    </>
  );
}
