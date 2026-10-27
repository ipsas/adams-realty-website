import { ArrowRight, ChevronRight, Info, Map as MapIcon, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaAgents } from "@/components/areas/area-agents";
import { AreaCta } from "@/components/areas/area-cta";
import { AreaJsonLd } from "@/components/areas/area-json-ld";
import { MlsCredit } from "@/components/content/mls-attribution";
import { MarketSnapshot } from "@/components/areas/market-snapshot";
import { RecentSales } from "@/components/areas/recent-sales";
import { ListingCard } from "@/components/listings/listing-card";
import { LinkButton } from "@/components/ui/button";
import { Photo } from "@/components/ui/photo";
import { Container, SectionHeading } from "@/components/ui/section";
import { areaHref, areaRegions, areas, countyLabel, type Area } from "@/config/areas";
import { site } from "@/config/site";
import {
  getAreaAgents,
  getAreaFeaturedListing,
  getAreaListings,
  getAreaRecentSales,
} from "@/lib/areas/queries";
import {
  formatAsOf,
  metaDescription,
  placeName,
  leadPhotoFallback,
  regionLabel,
  SOLD_WINDOW_DAYS,
} from "@/lib/areas/stats";
import { env } from "@/lib/env";
import { formatPrice, formatStreet } from "@/lib/format";
import { getCachedAreaGuide } from "@/lib/listings/cached";
import type { CardRow } from "@/lib/listings/card";
import { listingOfficeLabel } from "@/lib/listings/office-label";
import { OG_DEFAULT_IMAGE } from "@/lib/og";
import { searchHref } from "@/lib/search/params";

export async function generateMetadata(props: PageProps<"/areas/[slug]">): Promise<Metadata> {
  const guide = await getCachedAreaGuide((await props.params).slug);
  if (!guide) return { title: "Area not found" };
  const { area, stats } = guide;
  const title = `${placeName(area)} homes for sale & area guide`;
  const description = metaDescription(area, stats);
  const url = areaHref(area);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      images: stats.photo ? [{ url: stats.photo }] : [OG_DEFAULT_IMAGE],
    },
  };
}

export default async function AreaGuidePage(props: PageProps<"/areas/[slug]">) {
  const guide = await getCachedAreaGuide((await props.params).slug);
  if (!guide) notFound();
  const { area, stats } = guide;
  const [homes, featured, sales, agents] = await Promise.all([
    getAreaListings(area, 8),
    getAreaFeaturedListing(area),
    getAreaRecentSales(area, 4),
    getAreaAgents(area),
  ]);
  const asOf = new Date();
  const mapHref = searchHref({ q: area.name });
  const soldHref = searchHref({ q: area.name, mode: "sold", soldWithinDays: SOLD_WINDOW_DAYS });
  const siblings = areas.filter((a) => a.region === area.region && a.slug !== area.slug);
  // A region of one links a few guides from every other region instead.
  const related = siblings.length
    ? siblings
    : areaRegions.flatMap((r) =>
        areas.filter((a) => a.region === r.id && a.slug !== area.slug).slice(0, 3),
      );

  return (
    <>
      <AreaJsonLd area={area} baseUrl={env.NEXT_PUBLIC_SITE_URL} />

      {/* Hero */}
      <header className="border-b border-line bg-sunken/60">
        <Container className="pt-3 pb-14 sm:pt-5 sm:pb-20">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-sm text-muted">
              <li>
                <Link href="/areas" className="inline-flex h-10 items-center hover:text-ink">
                  Area guides
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRight className="size-3.5 text-faint" />
              </li>
              <li aria-current="page" className="truncate text-ink-soft">
                {area.name}
              </li>
            </ol>
          </nav>

          <div className="mt-6 grid grid-cols-1 items-center gap-10 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
            <div className="min-w-0">
              <p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brass-500 uppercase">
                <span className="h-px w-8 bg-brass-500" />
                {regionLabel(area.region)}
              </p>
              <h1 className="font-display-tight text-5xl leading-[1.02] font-normal text-ink sm:text-6xl lg:text-7xl">
                {area.name}
              </h1>
              <p className="mt-4 flex items-start gap-2 text-sm font-medium text-ink-soft">
                <MapPin className="mt-0.5 size-4 shrink-0 text-faint" />
                <span>
                  {area.city === area.name ? "" : `${area.city} · `}
                  {countyLabel(area)}, Georgia
                </span>
              </p>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
                {area.description}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <LinkButton href={mapHref} size="lg" className="w-full sm:w-auto">
                  {stats.forSale
                    ? `See ${stats.forSale} ${stats.forSale === 1 ? "home" : "homes"} for sale`
                    : `Search homes in ${area.name}`}
                  <ArrowRight />
                </LinkButton>
                <LinkButton
                  href="/sell#valuation"
                  size="lg"
                  variant="secondary"
                  className="w-full sm:w-auto"
                >
                  What&apos;s my home worth?
                </LinkButton>
              </div>
            </div>
            <FeaturedHome
              listing={featured}
              area={area}
              mapHref={mapHref}
              forSale={stats.forSale}
              salesShown={sales.length}
            />
          </div>
        </Container>
      </header>

      {/* Market snapshot */}
      <section aria-labelledby="market-heading" className="py-16 sm:py-20">
        <Container>
          <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-500 uppercase">
                Market snapshot
              </p>
              <h2
                id="market-heading"
                className="font-display-tight text-3xl font-medium text-ink sm:text-4xl"
              >
                The {area.name} market today
              </h2>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted">
              <span aria-hidden className="size-2 rounded-full bg-status-active" />
              Live as of {formatAsOf(asOf)}
            </p>
          </div>
          <MarketSnapshot stats={stats} rentalsHref={searchHref({ q: area.name, mode: "rent" })} />
        </Container>
      </section>

      {/* Highlights */}
      <section
        aria-labelledby="highlights-heading"
        className="border-y border-line bg-surface py-16 sm:py-20"
      >
        <Container className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-500 uppercase">
              Highlights
            </p>
            <h2
              id="highlights-heading"
              className="font-display-tight text-3xl font-medium text-ink sm:text-4xl"
            >
              Around {area.name}
            </h2>
            <ol className="mt-8 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
              {area.highlights.map((h, i) => (
                <li key={h} className="flex gap-4 border-t border-line py-5">
                  <span
                    aria-hidden
                    className="font-display text-xl leading-7 text-brass-500 tabular"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="leading-7 text-ink-soft">{h}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-4 lg:pt-12">
            {area.goodToKnow && (
              <div className="rounded-2xl bg-brass-100 p-6">
                <p className="flex items-center gap-2 text-sm font-semibold text-brass-700">
                  <Info className="size-4" /> Good to know
                </p>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{area.goodToKnow}</p>
              </div>
            )}
            <Link
              href={mapHref}
              className="group flex items-center gap-4 rounded-2xl border border-line p-5 transition-shadow hover:shadow-card"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <MapIcon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink group-hover:text-brand-700">
                  Explore {area.name} on the map
                </span>
                <span className="block text-sm text-muted">
                  Filter by price, beds and more, and save the search
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Container>
      </section>

      {/* Homes for sale */}
      <section className="py-16 sm:py-20">
        <Container>
          <SectionHeading
            eyebrow="For sale"
            title={`Homes for sale in ${area.name}`}
            description={
              homes.length
                ? homes.length < stats.forSale
                  ? `Newest first · showing ${homes.length} of ${stats.forSale}`
                  : "Newest first"
                : undefined
            }
            action={
              <LinkButton href={mapHref} variant="secondary">
                <MapIcon /> See all on the map
              </LinkButton>
            }
          />
          {homes.length ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {homes.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center">
              <p className="font-medium text-ink">Nothing for sale in {area.name} right now.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                Homes here come and go quickly. Search the map to save a search, or ask one of our
                agents about homes that haven&apos;t hit the market yet.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <LinkButton href={mapHref}>Search the map</LinkButton>
                <LinkButton href="/contact" variant="secondary">
                  Ask an agent
                </LinkButton>
              </div>
            </div>
          )}
        </Container>
      </section>

      {/* Recently sold + local agents */}
      <section className="pb-16 sm:pb-20">
        <Container className="grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-16">
          <div id="recently-sold" className="min-w-0 scroll-mt-24">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display-tight text-3xl font-medium text-ink">Recently sold</h2>
                <p className="mt-1 text-sm text-muted">
                  Closed sales in the last 6 months, newest first
                </p>
              </div>
              {sales.length > 0 && (
                <Link
                  href={soldHref}
                  className="-my-2 flex h-10 items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                >
                  All sold homes <ArrowRight className="size-4" />
                </Link>
              )}
            </div>
            {sales.length ? (
              <RecentSales sales={sales} />
            ) : (
              <p className="rounded-2xl border border-dashed border-line-strong p-6 text-sm text-muted">
                No closed sales in {area.name} in the last {SOLD_WINDOW_DAYS} days.
              </p>
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-6">
              <h2 className="font-display-tight text-3xl font-medium text-ink">Local agents</h2>
              <p className="mt-1 text-sm text-muted">Adams agents who work in {area.name}</p>
            </div>
            <AreaAgents agents={agents} areaName={area.name} />
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section className="pb-8">
        <Container>
          <AreaCta areaName={area.name} />
        </Container>
      </section>

      {/* More guides + notes */}
      <Container className="py-16">
        <div className="grid grid-cols-1 gap-10 border-t border-line pt-10 lg:grid-cols-2 lg:gap-16">
          <nav aria-labelledby="more-guides-heading">
            <h2
              id="more-guides-heading"
              className="text-xs font-semibold tracking-widest text-muted uppercase"
            >
              {siblings.length ? `More in ${regionLabel(area.region)}` : "More area guides"}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {related.map((a) => (
                <li key={a.slug}>
                  <Link
                    href={areaHref(a)}
                    className="flex h-10 items-center rounded-full border border-line bg-surface px-4 text-sm text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {a.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/areas"
                  className="flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-brand-700 hover:underline"
                >
                  All guides <ArrowRight className="size-4" />
                </Link>
              </li>
            </ul>
          </nav>
          <div className="space-y-2 text-xs leading-relaxed text-muted">
            <p>
              Market figures are calculated when this page loads, from listings on this site that
              match {area.name}. Asking-price, price-per-square-foot and days-on-market medians
              cover homes for sale now; sales cover the last {SOLD_WINDOW_DAYS} days. Figures from
              only a few homes can shift quickly.
            </p>
            <p>
              Area descriptions cover places and amenities, never the people who live there.{" "}
              <Link href="/fair-housing" className="underline hover:text-ink">
                Fair housing
              </Link>
            </p>
          </div>
        </div>
      </Container>
    </>
  );
}

/**
 * The guide's lead photo: a real home for sale here (never stock), linked and
 * attributed. With no home to show, its note matches the rest of the page.
 */
function FeaturedHome({
  listing,
  area,
  mapHref,
  forSale,
  salesShown,
}: {
  listing: CardRow | null;
  area: Area;
  mapHref: string;
  forSale: number;
  salesShown: number;
}) {
  const fallback = listing ? null : leadPhotoFallback(forSale, salesShown);
  const office = listing && listingOfficeLabel(listing, site);
  return (
    <Link
      href={
        listing
          ? `/homes/${listing.slug}`
          : fallback?.target === "sales"
            ? "#recently-sold"
            : mapHref
      }
      className="group relative isolate block aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-brand-800 shadow-lift"
    >
      <Photo
        src={listing?.primaryPhotoUrl}
        alt={listing ? `${formatStreet(listing)}, a home for sale in ${area.name}` : ""}
        priority
        sizes="(min-width: 1024px) 45vw, 100vw"
        className="absolute inset-0 -z-10 size-full transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        fallbackClassName="from-brand-600 via-brand-700 to-brand-900 text-brand-500"
      />
      {listing ? (
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-4 rounded-2xl bg-surface/95 py-3 pr-4 pl-4 shadow-pop backdrop-blur sm:inset-x-4 sm:bottom-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-brass-700 uppercase">
              {listing.isFeatured ? "Featured home" : "For sale"} in {area.name}
            </p>
            <p className="truncate text-sm font-medium text-ink">{formatStreet(listing)}</p>
            {office && <p className="text-sm break-words text-ink-soft">Listing by {office}</p>}
            {listing.fromFeed && <MlsCredit className="mt-0.5 text-xs text-muted" />}
          </div>
          <p className="shrink-0 text-lg font-semibold text-ink tabular">
            {formatPrice(listing.listPrice)}
          </p>
        </div>
      ) : (
        <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-surface/95 px-4 py-3 text-sm text-ink-soft shadow-pop sm:inset-x-4 sm:bottom-4">
          {fallback?.text}
        </div>
      )}
    </Link>
  );
}
