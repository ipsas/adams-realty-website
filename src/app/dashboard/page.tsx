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
import { NeedsAttention, ReplyTimes } from "@/components/dashboard/needs-attention";
import { LinkButton } from "@/components/ui/button";
import { db } from "@/db";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getOverview } from "@/lib/dashboard/queries";
import {
  attentionScope,
  getNeedsAttention,
  getReplyTimes,
  REPLY_WINDOW_DAYS,
} from "@/lib/leads/attention";
import { formatPriceShort, formatRelative } from "@/lib/format";

export const metadata = { title: "Overview" };

export default async function DashboardHome() {
  const actor = await requirePermission("/dashboard", can.viewDashboard);
  const now = new Date();
  const scope = attentionScope(actor);
  const [{ listingStats, leadStats, saves, recentLeads }, attention, replyTimes] =
    await Promise.all([
      getOverview(actor),
      scope ? getNeedsAttention(db, scope, now) : null,
      can.viewReplyTimes(actor) ? getReplyTimes(db, now) : null,
    ]);
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
      {attention && <NeedsAttention attention={attention} office={admin} now={now} />}
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

      {replyTimes && <ReplyTimes rows={replyTimes} days={REPLY_WINDOW_DAYS} />}

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
              // The whole row opens the lead; the home link sits above it (`relative z-10`).
              <tr key={l.id} className="group relative transition-colors hover:bg-sunken/50">
                <Td>
                  <Link
                    href={`/dashboard/leads/${l.id}`}
                    className="font-medium text-ink group-hover:text-brand-700 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand-500"
                  >
                    {l.name}
                  </Link>
                  <p className="text-xs">{l.email}</p>
                </Td>
                <Td>
                  <LeadTypeBadge type={l.type} />
                </Td>
                <Td>
                  {l.listingSlug ? (
                    <Link
                      href={`/homes/${l.listingSlug}`}
                      className="relative z-10 hover:text-brand-700"
                    >
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
