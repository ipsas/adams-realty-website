import { Star } from "lucide-react";
import Link from "next/link";
import { PageHeader, Table, Td, Th } from "@/components/dashboard/ui";
import { LinkButton } from "@/components/ui/button";
import { Photo } from "@/components/ui/photo";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getDashboardListings } from "@/lib/dashboard/queries";
import { formatPrice, formatRelative, statusLabel } from "@/lib/format";

export const metadata = { title: "Listings" };

export default async function DashboardListings() {
  const actor = await requirePermission("/dashboard/listings", can.viewDashboard);
  const rows = await getDashboardListings(actor);
  const admin = actor.role === "admin";
  return (
    <>
      <PageHeader
        title={admin ? "Company listings" : "My listings"}
        description={`${rows.length} listing${rows.length === 1 ? "" : "s"}. MLS-sourced listings are read-only here — edit them in the MLS and they update on the next sync.`}
        action={
          can.createListing(actor) ? (
            <LinkButton href="/dashboard/listings/new">New listing</LinkButton>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-sunken px-5 py-10 text-center text-sm text-muted">
          {actor.agentId || admin
            ? "No listings yet."
            : "Your login isn't linked to an agent profile yet, so there are no listings to show."}
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Home</Th>
              <Th>Status</Th>
              <Th className="text-right">Price</Th>
              {admin && <Th>Agent</Th>}
              <Th className="text-right">Saves</Th>
              <Th className="text-right">Leads</Th>
              <Th>Updated</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const editable = can.editListing(actor, {
                sourceKind: r.sourceKind,
                listAgentId: r.listAgentId,
              });
              return (
                <tr key={r.id} className="hover:bg-sunken/40">
                  <Td>
                    <div className="flex items-center gap-3">
                      <Photo
                        src={r.primaryPhotoUrl}
                        alt=""
                        sizes="64px"
                        className="h-10 w-14 shrink-0 rounded-lg"
                      />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                          {r.isFeatured && (
                            <Star
                              className="size-3.5 fill-brass-400 text-brass-400"
                              aria-label="Featured"
                            />
                          )}
                          {r.addressLine1}
                          {r.unitNumber && ` #${r.unitNumber}`}
                        </p>
                        <p className="text-xs">
                          {r.city} · {r.sourceKind === "manual" ? "Entered here" : "From MLS"}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>{statusLabel(r.status, r.transactionType)}</Td>
                  <Td className="text-right text-ink tabular">
                    {formatPrice(r.listPrice)}
                    {r.transactionType === "rent" && "/mo"}
                  </Td>
                  {admin && <Td>{r.agentName ?? "—"}</Td>}
                  <Td className="text-right tabular">{r.saves}</Td>
                  <Td className="text-right tabular">{r.leads}</Td>
                  <Td>{formatRelative(r.updatedAt)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <Link
                      href={`/homes/${r.slug}`}
                      className="mr-3 text-sm text-muted hover:text-ink"
                    >
                      View
                    </Link>
                    {editable && (
                      <Link
                        href={`/dashboard/listings/${r.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        Edit
                      </Link>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
