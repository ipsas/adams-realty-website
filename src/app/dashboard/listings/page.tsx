import { Star } from "lucide-react";
import Link from "next/link";
import {
  filterListings,
  ListingsFilter,
  listingsHref,
  parseListingsFilter,
  STATUS_TABS,
} from "@/components/dashboard/listings-filter";
import { PageHeader, Table, Td, Th } from "@/components/dashboard/ui";
import { ReturnSource } from "@/components/layout/return-link";
import { LinkButton } from "@/components/ui/button";
import { Photo } from "@/components/ui/photo";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { getDashboardListings } from "@/lib/dashboard/queries";
import { formatPrice, formatRelative, staffStatusLabel } from "@/lib/format";
import { isIdxHidden } from "@/lib/listings/visibility";

export const metadata = { title: "Listings" };

const STATUS_DOT: Record<string, string> = {
  active: "bg-status-active",
  coming_soon: "bg-status-soon",
  active_under_contract: "bg-status-pending",
  pending: "bg-status-pending",
  closed: "bg-status-sold",
};

export default async function DashboardListings(props: PageProps<"/dashboard/listings">) {
  const actor = await requirePermission("/dashboard/listings", can.viewDashboard);
  const filter = parseListingsFilter(await props.searchParams);
  const all = await getDashboardListings(actor);
  const { rows, counts } = filterListings(all, filter);
  const admin = actor.role === "admin";
  const filtered = !!(filter.status || filter.q);
  const noun = (n: number) => `listing${n === 1 ? "" : "s"}`;
  const tabLabel = STATUS_TABS.find((t) => t.key === filter.status)?.label.toLowerCase();

  return (
    <>
      <ReturnSource scope="listings" />
      <PageHeader
        title={admin ? "Company listings" : "My listings"}
        description={`${
          filtered
            ? `Showing ${rows.length} of ${all.length} ${noun(all.length)}`
            : `${all.length} ${noun(all.length)}`
        }. MLS-sourced listings are read-only here — edit them in the MLS and they update on the next sync.`}
        action={
          can.createListing(actor) ? (
            <LinkButton href="/dashboard/listings/new">New listing</LinkButton>
          ) : undefined
        }
      />
      {all.length === 0 ? (
        <p className="rounded-2xl bg-sunken px-5 py-10 text-center text-sm text-muted">
          {actor.agentId || admin
            ? "No listings yet."
            : "Your login isn't linked to an agent profile yet, so there are no listings to show."}
        </p>
      ) : (
        <>
          <ListingsFilter filter={filter} counts={counts} />
          {rows.length === 0 ? (
            <div className="rounded-2xl bg-sunken px-5 py-10 text-center text-sm text-muted">
              <p>
                {filter.q
                  ? `No ${tabLabel && filter.status ? `${tabLabel} ` : ""}listings match “${filter.q}”.`
                  : `No ${tabLabel} listings right now.`}
              </p>
              <Link
                href={listingsHref({ status: "", q: "" })}
                className="mt-2 inline-flex min-h-10 items-center font-medium text-brand-700 hover:underline"
              >
                Show all listings
              </Link>
            </div>
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
                            <p className="font-medium text-ink">
                              {r.isFeatured && (
                                <Star
                                  className="mr-1.5 inline size-3.5 -translate-y-px fill-brass-400 text-brass-400"
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
                      <Td>
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <span
                            aria-hidden
                            className={cn(
                              "size-2 rounded-full",
                              STATUS_DOT[r.status] ?? "bg-faint",
                            )}
                          />
                          {staffStatusLabel(r.status, r.transactionType)}
                        </span>
                      </Td>
                      <Td className="text-right text-ink tabular">
                        {formatPrice(r.listPrice)}
                        {r.transactionType === "rent" && "/mo"}
                      </Td>
                      {admin && <Td className="whitespace-nowrap">{r.agentName ?? "—"}</Td>}
                      <Td className="text-right tabular">{r.saves}</Td>
                      <Td className="text-right tabular">{r.leads}</Td>
                      <Td>{formatRelative(r.updatedAt)}</Td>
                      <Td className="text-right whitespace-nowrap">
                        {isIdxHidden(r) ? (
                          <span
                            className="mr-3 text-sm text-muted"
                            title="Coming soon, withdrawn, expired and canceled listings aren't shown on the public site."
                            data-testid="not-public"
                          >
                            Not public
                          </span>
                        ) : (
                          <Link
                            href={`/homes/${r.slug}`}
                            className="mr-3 text-sm text-muted hover:text-ink"
                          >
                            View
                          </Link>
                        )}
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
      )}
    </>
  );
}
