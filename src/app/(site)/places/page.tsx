import { ArrowRight, Map as MapIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { formatNumber } from "@/lib/format";
import { getCachedPlacesIndex } from "@/lib/listings/cached";
import { letterAnchors, placesIndexView } from "@/lib/listings/places-index";
import { searchHref } from "@/lib/search/params";

export const metadata: Metadata = {
  title: `Towns and cities in ${site.coverage.name}`,
  description: `Every town and city in ${site.coverage.name} with homes for sale on ${site.name}, grouped by county, with listings from ${site.mls.name}.`,
  alternates: { canonical: "/places" },
};

/**
 * "See all towns": every city with homes for sale, grouped by county, each
 * linking to its search. Built from the listings (getPlacesIndex), never a
 * hand-kept list, so it grows and shrinks with the feed.
 */
export default async function PlacesPage() {
  const view = placesIndexView(await getCachedPlacesIndex());
  const anchors = letterAnchors(view.counties);

  return (
    <>
      <header className="border-b border-line bg-sunken/60">
        <Container className="grid grid-cols-1 items-end gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-20">
          <div className="min-w-0">
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brass-500 uppercase">
              <span className="h-px w-8 bg-brass-500" />
              All towns
            </p>
            <h1 className="max-w-3xl font-display-tight text-4xl leading-[1.05] font-normal text-ink sm:text-5xl lg:text-6xl">
              Towns and cities across {site.coverage.name}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
              Every place with homes for sale on {site.name} right now, by county. Pick a town to
              see its homes on the map. Our agents work mainly in {site.market.region}; its counties
              are marked.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/homes" variant="secondary">
                <MapIcon /> Search every home on the map
              </LinkButton>
              <LinkButton href="/areas" variant="ghost">
                Area guides <ArrowRight />
              </LinkButton>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {[
              ["Towns", formatNumber(view.towns)],
              ["Counties", formatNumber(view.counties.filter((c) => c.county).length)],
              ["Homes for sale", formatNumber(view.homes)],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse bg-surface px-4 py-4 sm:px-5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-2xl font-semibold text-ink tabular">{value}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </header>

      <Container className="py-12 sm:py-16">
        {view.counties.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line-strong px-6 py-16 text-center text-muted">
            No homes are for sale right now. Check back soon.
          </p>
        ) : (
          <>
            {view.letters.length > 1 && (
              <nav
                aria-label="Counties by first letter"
                className="-mx-4 mb-10 scrollbar-none flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
              >
                {view.letters.map((l) => (
                  <a
                    key={l}
                    href={`#letter-${l.toLowerCase()}`}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-sm font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {l}
                  </a>
                ))}
              </nav>
            )}
            <div className="grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {view.counties.map((c) => (
                <section
                  key={c.id}
                  id={anchors.get(c.id)}
                  aria-labelledby={c.id}
                  data-county={c.county ?? ""}
                  className="min-w-0 scroll-mt-24"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3">
                    <h2 id={c.id} className="font-display-tight text-2xl font-medium text-ink">
                      {c.label}
                    </h2>
                    <p className="text-sm text-muted tabular">
                      {formatNumber(c.homes)} {c.homes === 1 ? "home" : "homes"}
                    </p>
                  </div>
                  {c.firmCounty && (
                    <p className="mt-3 inline-flex rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                      Our agents work here
                    </p>
                  )}
                  <ul className="mt-2">
                    {c.cities.map((city) => (
                      <li key={city.city}>
                        <Link
                          href={searchHref({ q: city.city })}
                          className="flex min-h-11 items-center justify-between gap-4 border-b border-line/70 text-ink-soft transition-colors hover:text-brand-700"
                        >
                          <span className="min-w-0 truncate font-medium">{city.city}</span>
                          <span className="shrink-0 text-sm text-muted tabular">
                            {formatNumber(city.count)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
        <p className="mt-16 text-xs leading-relaxed text-faint">
          Counts are homes for sale (active and coming soon) from {site.mls.name}, refreshed
          regularly. A town that crosses a county line is listed under each county with that
          county&apos;s homes.
        </p>
      </Container>
    </>
  );
}
