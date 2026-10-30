import { ArrowRight, BadgeDollarSign, EyeOff, RefreshCcw, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ListingCard } from "@/components/listings/listing-card";
import { HeroSearch } from "@/components/search/hero-search";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/components/seo/json-ld";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Photo } from "@/components/ui/photo";
import { Container, SectionHeading } from "@/components/ui/section";
import { HOME_TOWN_GUIDE_SLUGS, areaHref, areas as areaList, townGuide } from "@/config/areas";
import {
  HOME_DESCRIPTION,
  HOME_EYEBROW,
  HOME_EYEBROW_PARTS,
  HOME_TITLE,
} from "@/config/brand-copy";
import { site } from "@/config/site";
import { getAgents } from "@/lib/agents/queries";
import { formatNumber, formatPriceShort } from "@/lib/format";
import {
  getCachedFeaturedListings,
  getCachedMarketStats,
  getCachedPopularAreas,
} from "@/lib/listings/cached";
import { NO_HOMES_FOR_SALE } from "@/lib/listings/places-index";
import { FEATURED_MIN, getNewestListings } from "@/lib/listings/queries";
import { searchHref } from "@/lib/search/params";
import heroDusk from "@/../public/images/hero-dusk.jpg";

// Brand title and description (BR-B1); `absolute` skips the root layout's title template.
export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
};

/** Town chips under the hero search: fixed area guides, skipping any slug missing from the config. */
const POPULAR_AREAS = HOME_TOWN_GUIDE_SLUGS.flatMap((slug) =>
  areaList.filter((a) => a.slug === slug),
);

const SELL_IMAGE =
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=80";

/** A town's area guide when it has one, otherwise a search for its homes. */
function townHref(city: string): string {
  const guide = townGuide(city);
  return guide ? areaHref(guide) : searchHref({ q: city });
}

export default async function HomePage() {
  const [featured, newest, areas, stats, agents] = await Promise.all([
    getCachedFeaturedListings(8),
    getNewestListings(4),
    getCachedPopularAreas(9),
    getCachedMarketStats(),
    getAgents(),
  ]);

  return (
    <>
      <OrganizationJsonLd />
      <WebSiteJsonLd />
      {/* Hero */}
      <section className="relative isolate flex min-h-[92svh] items-end overflow-hidden bg-brand-900">
        <Image
          src={heroDusk}
          alt="Modern house with large windows at dusk"
          fill
          priority
          placeholder="blur"
          // Covers a box at least 92svh tall: on screens narrower than the 3:2 photo it is
          // about 1.5× the box height wide, not 100vw. Phones get about 1080w at 3×,
          // deliberately below the cropped box width to keep the download small; tablets
          // and desktop are unchanged.
          sizes="(max-width: 767px) 92vw, (max-aspect-ratio: 3/2) 150vh, 100vw"
          className="absolute inset-0 -z-20 object-cover"
          style={{ objectPosition: "60% 60%" }}
        />
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(90deg, rgba(10,14,20,0.85) 0%, rgba(10,14,20,0) 65%), rgba(0,0,0,0.28)",
          }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-t from-shade/85 via-shade/35 to-shade/40"
          aria-hidden="true"
        />
        <div className="absolute inset-0 -z-10 bg-black/20 xl:hidden" aria-hidden="true" />
        <Container className="pt-36 pb-10 sm:pb-14">
          {/* One text node, so the line shapes as before; too narrow for one line, it turns sr-only and an
              aria-hidden span draws the two halves on two lines from generated content. */}
          <p className="mb-5 flex items-center gap-2 text-xs font-semibold tracking-[0.22em] text-white/75 uppercase @container">
            <span className="h-px w-8 bg-brass-400" />
            <span data-home-eyebrow className="@max-[29.75em]:sr-only @min-[29.75em]:whitespace-nowrap">
              {HOME_EYEBROW}
            </span>
            <span
              aria-hidden="true"
              data-home-eyebrow-stacked
              data-line1={HOME_EYEBROW_PARTS[0]}
              data-line2={HOME_EYEBROW_PARTS[1]}
              className="before:block before:content-[attr(data-line1)] after:block after:content-[attr(data-line2)] @min-[29.75em]:hidden"
            />
          </p>
          <h1 className="max-w-3xl font-display-tight text-5xl leading-[1.02] font-normal text-white sm:text-7xl">
            Homes worth
            <br />
            <em className="font-light text-brass-100">coming home to.</em>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">
            Homes, land, farms and lake property around {site.market.focus.city}, updated directly
            from {site.mls.name}. Agents who actually pick up the phone.
          </p>
          <div className="mt-9">
            <HeroSearch />
          </div>
          {/* One swipeable row on phones; wraps from sm up. */}
          <nav
            aria-label="Popular towns"
            data-top-cities
            className="-mx-4 mt-5 scrollbar-none flex items-center gap-2 overflow-x-auto px-4 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          >
            <span className="shrink-0 text-white/60">Popular:</span>
            {POPULAR_AREAS.map((area) => (
              <Link
                key={area.slug}
                href={areaHref(area)}
                className="flex h-9 shrink-0 items-center rounded-full border border-white/60 px-3 whitespace-nowrap text-white/90 backdrop-blur-sm transition-colors hover:bg-white/15"
              >
                {area.name}
              </Link>
            ))}
            <Link
              href="/places"
              className="flex h-9 shrink-0 items-center gap-1 rounded-full px-2 font-medium whitespace-nowrap text-white underline-offset-4 hover:underline"
            >
              See all towns <ArrowRight className="size-3.5" />
            </Link>
          </nav>

          <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 backdrop-blur-md sm:grid-cols-4">
            {[
              { label: "Homes for sale", value: formatNumber(stats.active), href: "/homes" },
              {
                label: "New this week",
                value: formatNumber(stats.newThisWeek),
                href: "/homes?maxDaysOnMarket=7&sort=newest",
              },
              {
                label: "Open houses this week",
                value: formatNumber(stats.openHouses),
                href: "/homes?openHouse=1",
              },
              {
                label: "Median list price",
                value: stats.medianPrice ? formatPriceShort(stats.medianPrice) : "—",
                href: "/homes",
              },
            ].map((s) => (
              // A <dl> holds only dt/dd groups: the link is on the label and stretched over the tile.
              <div
                key={s.label}
                className="group relative bg-shade/25 px-5 py-4 transition-colors hover:bg-shade/40"
              >
                <dt className="text-xs text-white/65">
                  <Link href={s.href} className="after:absolute after:inset-0">
                    {s.label}
                  </Link>
                </dt>
                <dd className="mt-1 flex items-center gap-2 text-2xl font-semibold text-white tabular">
                  {s.value}
                  <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-70" />
                </dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* Featured: only the firm's listings and homes in its area, and only with enough of them. */}
      {featured.length >= FEATURED_MIN && (
        <section className="py-20 sm:py-24" data-featured>
          <Container>
            <SectionHeading
              eyebrow="Featured"
              title="Handpicked by our agents"
              description="Homes our team knows inside and out — ask us anything about them."
              action={
                <LinkButton href="/homes?ourListings=1" variant="secondary">
                  All Adams listings <ArrowRight />
                </LinkButton>
              }
            />
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((l, i) => (
                <ListingCard key={l.id} listing={l} priority={i < 4} />
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* Difference */}
      <section className="bg-brand-900 py-20 text-white sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-20">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-400 uppercase">
                The difference
              </p>
              <h2 className="font-display-tight text-4xl font-normal sm:text-5xl">
                A home search that&apos;s on <em className="text-brass-100">your</em> side.
              </h2>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70">
                The big portals make money selling your attention and your contact details. We make
                money by helping you buy or sell a home. That changes everything about how a search
                site should work.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-white/10 sm:grid-cols-2">
              {[
                {
                  icon: RefreshCcw,
                  title: "Straight from the MLS",
                  body: `Listings come directly from ${site.mls.name}, not another portal's copy, and every one credits the brokerage that listed it.`,
                },
                {
                  icon: ShieldCheck,
                  title: "Your info stays with us",
                  body: "We never sell your details. One inquiry reaches one Adams Realty agent — not a bidding war of strangers.",
                },
                {
                  icon: BadgeDollarSign,
                  title: "The true cost of owning",
                  body: "Each home's payment estimate includes taxes, insurance, HOA and PMI — not just the loan.",
                },
                {
                  icon: EyeOff,
                  title: "Zero ads.",
                  body: "No sponsored listings, no pop-ups, no “premier agent” placements. Just homes.",
                },
              ].map((f) => (
                <div key={f.title} className="bg-brand-900 p-7">
                  <f.icon className="size-6 text-brass-400" strokeWidth={1.75} />
                  <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* Towns */}
      <section className="py-20 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow="Explore"
            title={`Towns and cities across ${site.coverage.name}`}
            description="From city neighborhoods and small-town main streets to the mountains, the lakes and the coast."
            action={
              <LinkButton href="/places" variant="secondary">
                See all towns <ArrowRight />
              </LinkButton>
            }
          />
          {areas.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-line-strong px-6 py-16 text-center text-muted">
              {NO_HOMES_FOR_SALE}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {areas.map((a, i) => (
                <Link
                  key={a.city}
                  href={townHref(a.city)}
                  className={`group relative isolate overflow-hidden rounded-[var(--radius-card)] bg-brand-800 ${i === 0 ? "col-span-2 row-span-2 aspect-square sm:aspect-auto" : "aspect-[4/5] sm:aspect-[4/3]"}`}
                >
                  <Photo
                    src={a.photo}
                    alt=""
                    sizes={
                      i === 0 ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"
                    }
                    className="absolute inset-0 -z-20 size-full transition-transform duration-700 group-hover:scale-105"
                    fallbackClassName="from-brand-600 via-brand-700 to-brand-900 text-brand-500"
                  />
                  <div className="absolute inset-0 -z-10 bg-gradient-to-t from-shade/80 via-shade/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                    <p
                      className={`font-display-tight font-medium ${i === 0 ? "text-3xl" : "text-xl"}`}
                    >
                      {a.city}
                    </p>
                    <p className="mt-1 text-sm text-white/75">
                      {a.count} homes · median {formatPriceShort(a.medianPrice)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Container>
      </section>

      {/* Sell */}
      <section className="py-8">
        <Container>
          <div className="grid grid-cols-1 overflow-hidden rounded-[2rem] bg-brass-100 lg:grid-cols-2">
            <div className="p-8 sm:p-12 lg:p-16">
              <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-700 uppercase">
                Selling?
              </p>
              <h2 className="font-display-tight text-4xl font-normal text-ink sm:text-5xl">
                Find out what your property is really worth.
              </h2>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-soft">
                Algorithms guess. One of our {site.market.region} agents looks at your home or land
                and what has actually sold nearby — in town, on the lake or by the acre. Get a free,
                no-obligation valuation.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <LinkButton href="/sell#valuation" size="lg">
                  Get my home value
                </LinkButton>
                <LinkButton href="/sell" size="lg" variant="ghost">
                  How we sell homes <ArrowRight />
                </LinkButton>
              </div>
            </div>
            <div className="relative min-h-72">
              <Photo
                src={SELL_IMAGE}
                alt="Bright living room staged for sale"
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="absolute inset-0 size-full"
              />
            </div>
          </div>
        </Container>
      </section>

      {/* Agents */}
      <section className="py-20 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow={`Our team in ${site.market.region}`}
            title="Local agents, not call centers"
            action={
              <LinkButton href="/agents" variant="secondary">
                Meet all {agents.length} agents <ArrowRight />
              </LinkButton>
            }
          />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
            {agents.slice(0, 5).map((a) => (
              <Link key={a.id} href={`/agents/${a.slug}`} className="group">
                <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-sunken">
                  <Avatar
                    src={a.photoUrl}
                    name={a.name}
                    className="size-full text-5xl transition-transform duration-700 group-hover:scale-105"
                  />
                </div>
                <p className="mt-3 font-semibold text-ink">{a.name}</p>
                <p className="text-sm text-muted">{a.title}</p>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      {/* Newest */}
      {newest.length > 0 && (
        <section className="pb-8">
          <Container>
            <SectionHeading
              eyebrow="Just listed"
              title="New on the market"
              action={
                <LinkButton href="/homes?sort=newest" variant="secondary">
                  See all new listings <ArrowRight />
                </LinkButton>
              }
            />
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {newest.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          </Container>
        </section>
      )}
    </>
  );
}
