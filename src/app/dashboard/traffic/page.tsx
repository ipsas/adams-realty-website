import Link from "next/link";
import { PageHeader, StatCard, Table, Td, Th } from "@/components/dashboard/ui";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { site } from "@/config/site";
import { db } from "@/db";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatNumber } from "@/lib/format";
import {
  getDailyViewTotals,
  getListingViews,
  parseViewRange,
  trafficOfficeLabel,
} from "@/lib/listings/views";

export const metadata = { title: "Listing traffic" };

const TOP = 50;

/**
 * Listing page views over a date range, and the CSV Georgia MLS can be sent
 * (IDX agreement, Exhibit A §9: traffic statistics, including listing pages
 * viewed, made available at no charge). Admins only.
 */
export default async function TrafficPage(props: PageProps<"/dashboard/traffic">) {
  await requirePermission("/dashboard/traffic", can.viewTrafficStats);
  const params = await props.searchParams;
  const range = parseViewRange({
    from: typeof params.from === "string" ? params.from : null,
    to: typeof params.to === "string" ? params.to : null,
  });
  const [top, daily] = await Promise.all([
    getListingViews(db, range, { limit: TOP }),
    getDailyViewTotals(db, range),
  ]);
  const total = daily.reduce((s, d) => s + d.views, 0);
  const query = new URLSearchParams(range).toString();

  return (
    <>
      <PageHeader
        title="Listing traffic"
        description={`Listing page views by day (${site.market.timeZone}). ${site.mls.name} may ask for these statistics under our IDX agreement: download the CSV and send it to them.`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/dashboard/traffic/export?${query}&feed=1`} variant="secondary">
              {site.mls.name} listings CSV
            </LinkButton>
            <LinkButton href={`/dashboard/traffic/export?${query}`}>All listings CSV</LinkButton>
          </div>
        }
      />
      <form className="mb-8 flex flex-wrap items-end gap-4" method="get">
        <Field label="From" htmlFor="from">
          <Input id="from" name="from" type="date" defaultValue={range.from} />
        </Field>
        <Field label="To" htmlFor="to">
          <Input id="to" name="to" type="date" defaultValue={range.to} />
        </Field>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Listing page views" value={formatNumber(total)} />
        <StatCard label="Days with views" value={daily.length} />
        <StatCard
          label="Busiest day"
          value={
            daily.length ? formatNumber(Math.max(...daily.map((d) => d.views))) : formatNumber(0)
          }
        />
      </div>
      <h2 className="mb-3 font-semibold text-ink">Most viewed listings</h2>
      {top.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Listing</Th>
              <Th>MLS #</Th>
              <Th>Listing office</Th>
              <Th className="text-right">Views</Th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.listingId}>
                <Td>
                  <Link href={`/homes/${r.slug}`} className="font-medium text-ink hover:underline">
                    {r.address}, {r.city}
                  </Link>
                </Td>
                <Td>{r.mlsNumber ?? "—"}</Td>
                <Td>{trafficOfficeLabel(r)}</Td>
                <Td className="text-right tabular">{formatNumber(r.views)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="text-sm text-muted" data-testid="traffic-empty">
          No listing page views in this range.
        </p>
      )}
    </>
  );
}
