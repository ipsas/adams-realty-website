import { ArrowRight, Map as MapIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AreaCard, AreaFeatureCard } from "@/components/areas/area-card";
import { AreaSortNav } from "@/components/areas/area-sort-nav";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/section";
import { areas } from "@/config/areas";
import { site } from "@/config/site";
import { getAreaSummaries } from "@/lib/areas/queries";
import {
  formatAsOf,
  groupByRegion,
  parseAreaSort,
  SOLD_WINDOW_DAYS,
  sortAreas,
  type AreaSummary,
} from "@/lib/areas/stats";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = {
  title: "Area guides",
  description: `Live market stats and local context for ${areas.length} towns and lakes across ${site.market.region}: median prices, days on market, recent sales, and the parks, lakes and landmarks that define each area.`,
  alternates: { canonical: "/areas" },
};

export default async function AreasPage(props: PageProps<"/areas">) {
  const sort = parseAreaSort((await props.searchParams).sort);
  const summaries = await getAreaSummaries();
  const asOf = new Date();
  const totals = summaries.reduce(
    (t, s) => ({ forSale: t.forSale + s.stats.forSale, sold: t.sold + s.stats.recentSales }),
    { forSale: 0, sold: 0 },
  );

  return (
    <>
      <header className="border-b border-line bg-sunken/60">
        <Container className="grid grid-cols-1 items-end gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-20">
          <div className="min-w-0">
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brass-500 uppercase">
              <span className="h-px w-8 bg-brass-500" />
              Area guides
            </p>
            <h1 className="max-w-3xl font-display-tight text-4xl leading-[1.05] font-normal text-ink sm:text-5xl lg:text-6xl">
              Know the area <em className="text-brand-700">before you tour.</em>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
              Live numbers from the homes on the market today (asking prices, days on market, recent
              sales) alongside the lakes, parks and landmarks that define each part of{" "}
              {site.market.region}.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/homes" variant="secondary">
                <MapIcon /> Search every home on the map
              </LinkButton>
            </div>
          </div>
          <div>
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line">
              {[
                ["Guides", formatNumber(summaries.length)],
                ["Homes for sale", formatNumber(totals.forSale)],
                ["Sold, 6 months", formatNumber(totals.sold)],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col-reverse bg-surface px-4 py-4 sm:px-5">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="text-2xl font-semibold text-ink tabular">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">Live as of {formatAsOf(asOf)}</p>
          </div>
        </Container>
      </header>

      <Container className="py-12 sm:py-16">
        <div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {sort === "region" ? (
            <nav aria-label="Jump to region" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Jump to</span>
              {groupByRegion(summaries).map(({ region }) => (
                <a
                  key={region.id}
                  href={`#${region.id}`}
                  className="flex h-10 items-center rounded-full border border-line bg-surface px-4 font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                >
                  {region.label}
                </a>
              ))}
            </nav>
          ) : (
            // An h2 (styled as a note) so the flat list's card h3s sit under a heading.
            <h2 className="text-sm font-normal text-muted">
              {summaries.length} guides, sorted{" "}
              {sort === "homes"
                ? "by homes for sale"
                : sort === "name"
                  ? "A–Z"
                  : sort === "price-low"
                    ? "by median list price, lowest first"
                    : "by median list price, highest first"}
            </h2>
          )}
          <AreaSortNav current={sort} />
        </div>

        {sort === "region" ? (
          <div className="space-y-20">
            {groupByRegion(summaries).map(({ region, items }, gi) => (
              <section key={region.id} id={region.id} className="scroll-mt-24">
                <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-2 border-b border-line pb-5">
                  <div className="max-w-2xl">
                    <h2 className="font-display-tight text-3xl font-medium text-ink sm:text-4xl">
                      {region.label}
                    </h2>
                    <p className="mt-2 text-muted">{region.blurb}</p>
                  </div>
                  <p className="text-sm text-muted tabular">
                    {items.length} {items.length === 1 ? "guide" : "guides"} ·{" "}
                    {formatNumber(items.reduce((n, s) => n + s.stats.forSale, 0))} homes for sale
                  </p>
                </div>
                {items.length <= 2 ? (
                  // One or two guides read better as wide features than as a
                  // couple of lonely tiles in a five-column grid.
                  <div className="space-y-6">
                    {items.map((s, i) => (
                      <AreaFeatureCard
                        key={s.area.slug}
                        area={s.area}
                        stats={s.stats}
                        priority={gi === 0 && i === 0}
                      />
                    ))}
                  </div>
                ) : (
                  <AreaGrid items={items} priority={gi === 0} />
                )}
              </section>
            ))}
          </div>
        ) : (
          <AreaGrid items={sortAreas(summaries, sort)} showRegion priority />
        )}

        <aside className="mt-24 grid grid-cols-1 gap-8 rounded-3xl border border-line bg-surface p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-muted">
            <h2 className="text-base font-semibold text-ink">About these numbers</h2>
            <p>
              Figures are calculated when you load the page from the listings on this site. Asking
              prices, price per square foot and days on market cover homes for sale now; sales cover
              the last {SOLD_WINDOW_DAYS} days. Small areas can swing a lot from week to week, so
              each guide shows how many homes sit behind every number.
            </p>
            <p>
              Our guides describe places (lakes, parks, landmarks and historic downtowns), never
              the people who live there.{" "}
              <Link href="/fair-housing" className="font-medium text-brand-700 hover:underline">
                Our fair housing commitment
              </Link>
            </p>
          </div>
          <LinkButton href="/contact" variant="secondary" size="lg">
            Don&apos;t see your area? Ask us <ArrowRight />
          </LinkButton>
        </aside>
      </Container>
    </>
  );
}

function AreaGrid({
  items,
  showRegion = false,
  priority = false,
}: {
  items: AreaSummary[];
  showRegion?: boolean;
  priority?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {items.map((s, i) => (
        <AreaCard
          key={s.area.slug}
          area={s.area}
          stats={s.stats}
          showRegion={showRegion}
          priority={priority && i < 5}
        />
      ))}
    </div>
  );
}
