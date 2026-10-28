import {
  Bath,
  BedDouble,
  CalendarDays,
  Car,
  ChevronRight,
  Clock,
  DollarSign,
  Flag,
  Home,
  Hash,
  LandPlot,
  Ruler,
  School,
  Tag,
  TrendingDown,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { MlsAttribution } from "@/components/content/mls-attribution";
import { telHref } from "@/components/content/contact";
import { ReturnLink } from "@/components/layout/return-link";
import { SiteFooter } from "@/components/layout/site-footer";
import { ContactForm } from "@/components/listings/contact-form";
import { CountView } from "@/components/listings/count-view";
import { ListingCard } from "@/components/listings/listing-card";
import { ListingCtaBar } from "@/components/listings/listing-cta-bar";
import { LocationMapLazy } from "@/components/listings/location-map-lazy";
import { PaymentCalculator } from "@/components/listings/payment-calculator";
import { PhotoGallery } from "@/components/listings/photo-gallery";
import { RecordView } from "@/components/listings/record-view";
import { SaveButton } from "@/components/listings/save-button";
import { ShareButton } from "@/components/listings/share-button";
import { Avatar } from "@/components/ui/avatar";
import { Expandable } from "@/components/ui/expandable";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { db } from "@/db";
import type { ListingFeatures } from "@/db/schema";
import { offersTours } from "@/lib/areas/firm-area";
import { placeHref } from "@/lib/areas/links";
import { marketToday } from "@/lib/areas/stats";
import { getActor, getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";
import { env } from "@/lib/env";
import {
  daysSince,
  formatBaths,
  formatCityLine,
  formatDate,
  formatFullAddress,
  formatLot,
  formatNumber,
  formatOpenHouse,
  formatPrice,
  formatRelative,
  formatStreet,
  isNullLike,
  PROPERTY_TYPE_LABELS,
  statusLabel,
} from "@/lib/format";
import { listingContact } from "@/lib/listings/attribution-contact";
import { hoaFact, listingDetailGroups } from "@/lib/listings/detail-fields";
import { redactAccessCodes, withoutExcludedFields } from "@/lib/listings/excluded-fields";
import {
  formatAcres,
  formatPricePerAcre,
  isBareLand,
  isLandType,
  LAND_LOAN_NOTE,
  landFacts,
} from "@/lib/listings/land";
import { listingIndexingMode, listingRobots } from "@/lib/listings/indexing";
import {
  listingBreadcrumbJsonLd,
  listingDescription,
  listingTitle,
} from "@/lib/listings/listing-seo";
import { listingOfficeLabel } from "@/lib/listings/office-label";
import { getListingBySlug, getSimilarListings, type ListingDetail } from "@/lib/listings/queries";
import { normalizeTaxYear } from "@/lib/listings/tax-year";
import { formatLastUpdated, mlsDisclaimer, sourceDisclaimer } from "@/lib/mls-copyright";
import { gamlsLastSyncedAt } from "@/lib/mls/last-updated";
import { financeFor, listingMonthlyCost, monthlyHoaAmount } from "@/lib/mortgage";
import { isMarketState, normalizeState } from "@/lib/market-state";
import { OG_DEFAULT_IMAGE } from "@/lib/og";
import { formatSchoolName } from "@/lib/search/school-name";

export async function generateMetadata(props: PageProps<"/homes/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getListingBySlug(slug);
  if (!data) return { title: "Home not found" };
  const l = data.listing;
  const title = listingTitle(l);
  const description = listingDescription(l);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/homes/${l.slug}` },
    openGraph: {
      title,
      description,
      images: l.primaryPhotoUrl ? [{ url: l.primaryPhotoUrl }] : [OG_DEFAULT_IMAGE],
    },
    // Off-market, sold and out-of-area listings stay reachable but aren't indexed
    // (src/lib/listings/indexing.ts).
    robots: listingRobots(l, listingIndexingMode()),
  };
}

export default async function ListingPage(props: PageProps<"/homes/[slug]">) {
  const { slug } = await props.params;
  const data = await getListingBySlug(slug);
  if (!data) notFound();
  const { listing: l, media, openHouses, events, agent, source } = data;
  const [similar, session, actor, lastSynced] = await Promise.all([
    getSimilarListings(l),
    getSession(),
    getActor(),
    gamlsLastSyncedAt(db),
  ]);

  const { phone: attributionPhone, email: attributionEmail } = listingContact({
    ...l,
    listAgentMlsId: agent?.mlsAgentId,
  });
  const taxYear = normalizeTaxYear(l.taxYear);
  const disclaimer = sourceDisclaimer(source);
  // IDX: a page with Georgia MLS listings (this one or a similar home) shows its disclaimer.
  const footerDisclaimer =
    [
      ...new Set(
        [
          disclaimer,
          l.fromFeed || similar.some((s) => s.fromFeed) ? mlsDisclaimer(lastSynced) : null,
        ].filter(Boolean),
      ),
    ].join(" ") || null;
  const photos = media
    .filter((m) => m.kind === "photo")
    .map((m) => ({ url: m.url, caption: m.caption }));
  const sold = l.status === "closed";
  const rent = l.transactionType === "rent";
  const priceCut =
    !sold && l.originalListPrice && l.originalListPrice > l.listPrice
      ? l.originalListPrice - l.listPrice
      : 0;
  const monthlyHoa = monthlyHoaAmount(l.hoaFee, l.hoaFrequency);
  // Land with no house (site review #8): no home to insure, a land loan instead of a home
  // mortgage, and none of a house's facts.
  const bare = isBareLand(l);
  // "About this home" for homes; land, commercial and other property is a property.
  const home = !bare && l.propertyType !== "commercial" && l.propertyType !== "other";
  const perAcre =
    !rent && isLandType(l.propertyType)
      ? formatPricePerAcre(sold && l.closePrice ? l.closePrice : l.listPrice, l.lotSizeSqft)
      : null;
  // Georgia county rates and area guides only fit a Georgia listing; elsewhere, neither shows.
  const inMarket = isMarketState(l.state);
  // Insurance and the tax fallback follow the county (coastal and metro rates differ).
  const finance = financeFor(l.county);
  // The same estimate the calculator (#costs) starts from.
  const estimate = listingMonthlyCost({
    price: l.listPrice,
    annualTax: l.taxAnnualAmount,
    monthlyHoa,
    finance,
    land: bare,
  });
  // Tours only where our agents work (or on our own listings); elsewhere, a question to the office.
  const tours = offersTours(l);
  const dom = daysSince(l.listDate);
  const street = formatStreet(l);
  // Rows synced before the mapper dropped placeholders can still hold "None".
  const neighborhood = isNullLike(l.neighborhood) ? null : l.neighborhood;
  const canEdit = can.editListing(actor, { sourceKind: source.kind, listAgentId: l.listAgentId });
  // IDX: the listing firm, named prominently (gamls2 sends no office name: listingOfficeLabel).
  const office = listingOfficeLabel(l, site);
  const hoa = hoaFact(l);
  const details = listingDetailGroups(l);

  return (
    <>
      <main className="flex-1 pb-24 lg:pb-0">
        <JsonLd data={data} />
        <CountView listingId={l.id} />
        <RecordView
          snapshot={{
            slug: l.slug,
            address: street,
            cityLine: formatCityLine(l),
            price: sold && l.closePrice ? l.closePrice : l.listPrice,
            photo: l.primaryPhotoUrl ?? photos[0]?.url ?? null,
            beds: l.bedrooms,
            baths: l.bathrooms,
            listOfficeName: office,
            transactionType: l.transactionType,
            status: l.status,
          }}
        />
        <Container className="pt-5">
          {l.removedAt && (
            <p className="mb-4 rounded-2xl bg-clay-50 px-4 py-3 text-sm text-clay-600">
              This home is no longer on the market.
              {inMarket && (
                <>
                  {" "}
                  <Link
                    href={placeHref(neighborhood ?? l.city, l.county)}
                    className="font-semibold underline"
                  >
                    See similar homes nearby
                  </Link>
                  .
                </>
              )}
            </p>
          )}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              {/* Back to the search this home was opened from (or the last one). */}
              <ReturnLink scope="search" fallback="/homes">
                Back to results
              </ReturnLink>
              <nav
                aria-label="Breadcrumb"
                className="hidden items-center gap-1 text-sm text-muted sm:flex"
              >
                <Link href="/homes" className="hover:text-ink">
                  Homes
                </Link>
                {inMarket && (
                  <>
                    <ChevronRight className="size-3.5" />
                    <Link href={placeHref(l.city, l.county)} className="hover:text-ink">
                      {l.city}
                    </Link>
                    {neighborhood && neighborhood !== l.city && (
                      <>
                        <ChevronRight className="size-3.5" />
                        <Link href={placeHref(neighborhood, l.county)} className="hover:text-ink">
                          {neighborhood}
                        </Link>
                      </>
                    )}
                  </>
                )}
              </nav>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <Link
                  href={`/dashboard/listings/${l.id}`}
                  className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-medium text-on-ink hover:bg-ink-soft"
                >
                  Edit listing
                </Link>
              )}
              <ShareButton title={formatFullAddress(l)} />
              {!l.removedAt && <SaveButton listingId={l.id} variant="outline" />}
            </div>
          </div>

          <PhotoGallery photos={photos} alt={formatFullAddress(l)} />

          <div className="mt-8 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-16">
            <div className="min-w-0">
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={l.status} transactionType={l.transactionType} />
                {dom !== null && dom >= 0 && !sold && (
                  <span className="text-sm text-muted">
                    {dom === 0
                      ? "Listed today"
                      : `${dom} day${dom === 1 ? "" : "s"} on ${site.name}`}
                  </span>
                )}
                {l.isCompanyListing && (
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                    Adams Realty listing
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div>
                  <p className="text-4xl font-semibold tracking-tight text-ink tabular sm:text-5xl">
                    {formatPrice(sold && l.closePrice ? l.closePrice : l.listPrice)}
                    {rent && <span className="text-xl font-normal text-muted">/mo</span>}
                  </p>
                  {sold && l.closeDate && (
                    <p className="mt-1 text-sm text-muted">
                      Sold {formatDate(l.closeDate)} · listed at {formatPrice(l.listPrice)}
                    </p>
                  )}
                  {priceCut > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-sm font-medium text-clay-600">
                      <TrendingDown className="size-4" /> Price cut {formatPrice(priceCut)}
                    </p>
                  )}
                </div>
                {!rent && !sold && inMarket && (
                  // ml-auto: when the price and this wrap onto two lines (a phone, a long land
                  // note), it still sits at the right edge instead of floating mid-screen.
                  <a
                    href="#costs"
                    className="group ml-auto flex flex-col items-end text-right"
                    data-testid="estimate-pill"
                  >
                    <p className="text-sm text-muted">Est. monthly cost</p>
                    <p className="text-xl font-semibold text-ink tabular group-hover:text-brand-700">
                      {formatPrice(Math.round(estimate.total))}/mo
                    </p>
                    {bare && <p className="max-w-56 text-xs text-muted">{LAND_LOAN_NOTE}</p>}
                  </a>
                )}
              </div>
              <h1 className="mt-3 text-lg text-ink-soft">
                <span className="font-semibold text-ink">{street}</span>, {formatCityLine(l)}
              </h1>
              {office && (
                <p className="mt-1 text-sm text-ink-soft" data-testid="listing-office">
                  Listing by <span className="font-medium text-ink">{office}</span>
                </p>
              )}

              {/* No empty cell may show the strip's line color: a home's four facts are two
                  by two on phones, a row from sm up; bare land's two (one with no price per
                  acre) are stacked on phones, where "$276,000/acre" needs the full width. */}
              <dl
                className={cn(
                  "mt-6 grid gap-px overflow-hidden rounded-2xl border border-line bg-line",
                  !bare
                    ? "grid-cols-2 sm:grid-cols-4"
                    : perAcre
                      ? "grid-cols-1 sm:grid-cols-2"
                      : "grid-cols-1",
                )}
                data-testid="big-facts"
              >
                {bare ? (
                  <>
                    <BigFact
                      icon={<LandPlot />}
                      label="Acreage"
                      value={formatAcres(l.lotSizeSqft)}
                    />
                    {perAcre && <BigFact icon={<Tag />} label="Price per acre" value={perAcre} />}
                  </>
                ) : (
                  <>
                    <BigFact icon={<BedDouble />} label="Beds" value={l.bedrooms ?? "—"} />
                    <BigFact icon={<Bath />} label="Baths" value={formatBaths(l.bathrooms)} />
                    <BigFact
                      icon={<Ruler />}
                      label="Sq ft"
                      value={formatNumber(l.livingAreaSqft)}
                    />
                    <BigFact
                      icon={<LandPlot />}
                      label="Lot"
                      value={formatLot(l.lotSizeSqft).replace(" lot", "")}
                    />
                  </>
                )}
              </dl>

              {openHouses.length > 0 && (
                <section className="mt-8 rounded-2xl border border-brass-400/40 bg-brass-100/60 p-5">
                  <h2 className="flex items-center gap-2 font-semibold text-brass-700">
                    <CalendarDays className="size-5" /> Open house{openHouses.length > 1 ? "s" : ""}
                  </h2>
                  <ul className="mt-2 space-y-1">
                    {openHouses.map((o) => (
                      <li key={o.id} className="text-ink">
                        {formatOpenHouse(o.startsAt, o.endsAt)}
                        {o.type === "virtual" && " · Virtual"}
                        {o.remarks && <span className="text-sm text-muted"> — {o.remarks}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Section title={home ? "About this home" : "About this property"}>
                {l.headline && <p className="mb-3 text-lg font-medium text-ink">{l.headline}</p>}
                {l.description ? (
                  <Expandable collapsedHeight="9rem">
                    <p className="leading-relaxed whitespace-pre-line text-ink-soft">
                      {redactAccessCodes(l.description)}
                    </p>
                  </Expandable>
                ) : (
                  <p className="text-muted">No description provided.</p>
                )}
                <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                  <Fact
                    icon={<Home />}
                    label="Type"
                    value={l.propertySubType ?? PROPERTY_TYPE_LABELS[l.propertyType]}
                  />
                  {/* A house's facts; bare land has none of them (site review #8). */}
                  {!bare && (
                    <Fact icon={<CalendarDays />} label="Year built" value={l.yearBuilt ?? "—"} />
                  )}
                  {isLandType(l.propertyType) && l.lotSizeSqft ? (
                    <Fact icon={<LandPlot />} label="Acreage" value={formatAcres(l.lotSizeSqft)} />
                  ) : null}
                  {perAcre && <Fact icon={<Tag />} label="Price per acre" value={perAcre} />}
                  {!rent && !bare && l.livingAreaSqft ? (
                    <Fact
                      icon={<Tag />}
                      label="Price per sq ft"
                      value={formatPrice(Math.round(l.listPrice / l.livingAreaSqft))}
                    />
                  ) : null}
                  {hoa && <Fact icon={<DollarSign />} label="HOA" value={hoa} />}
                  {!bare && (
                    <Fact
                      icon={<Car />}
                      label="Garage"
                      value={
                        l.garageSpaces
                          ? `${l.garageSpaces} car${l.garageSpaces > 1 ? "s" : ""}`
                          : "—"
                      }
                    />
                  )}
                  {l.taxAnnualAmount ? (
                    <Fact
                      icon={<DollarSign />}
                      label={`Property tax${taxYear ? ` (${taxYear})` : ""}`}
                      value={`${formatPrice(l.taxAnnualAmount)}/yr`}
                    />
                  ) : null}
                  <Fact icon={<Clock />} label="Listed" value={formatDate(l.listDate)} />
                  {l.mlsNumber && <Fact icon={<Hash />} label="MLS #" value={l.mlsNumber} />}
                </dl>
              </Section>

              <FeatureSection features={l.features} flags={l} />

              {details.length > 0 && (
                <Section title="Property details" id="details">
                  <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
                    {details.map((g) => (
                      <div key={g.title}>
                        <h3 className="text-xs font-semibold tracking-widest text-faint uppercase">
                          {g.title}
                        </h3>
                        <dl className="mt-1.5 space-y-1.5 text-sm leading-relaxed">
                          {g.rows.map((r) => (
                            <InfoRow key={r.label} label={r.label} value={r.value} />
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {!rent && !sold && inMarket && (
                <Section title="Monthly cost" id="costs">
                  <PaymentCalculator
                    price={l.listPrice}
                    annualTax={l.taxAnnualAmount}
                    monthlyHoa={monthlyHoa}
                    insuranceRatePct={finance.insuranceRatePct}
                    taxRatePct={finance.propertyTaxRatePct}
                    land={bare}
                  />
                </Section>
              )}

              {events.length > 0 && (
                <Section title="Price & status history">
                  <div className="overflow-hidden rounded-2xl border border-line">
                    <table className="w-full text-sm">
                      <thead className="bg-sunken text-left text-xs tracking-wide text-muted uppercase">
                        <tr>
                          <th className="px-4 py-3 font-medium">Date</th>
                          <th className="px-4 py-3 font-medium">Event</th>
                          <th className="px-4 py-3 text-right font-medium">Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line bg-surface">
                        {events.map((e) => (
                          <tr key={e.id}>
                            <td className="px-4 py-3 text-ink-soft">{formatDate(e.occurredAt)}</td>
                            <td className="px-4 py-3 text-ink">{eventLabel(e)}</td>
                            <td className="px-4 py-3 text-right text-ink tabular">
                              {formatPrice(e.price)}
                              {e.previousPrice && e.price ? (
                                <span
                                  className={cn(
                                    "ml-2 text-xs",
                                    e.price < e.previousPrice ? "text-clay-600" : "text-brand-600",
                                  )}
                                >
                                  {e.price < e.previousPrice ? "−" : "+"}
                                  {(
                                    (Math.abs(e.price - e.previousPrice) / e.previousPrice) *
                                    100
                                  ).toFixed(1)}
                                  %
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {(l.schools.elementary || l.schools.middle || l.schools.high) && (
                <Section title="Schools">
                  {l.schools.district && (
                    <p className="mb-4 text-sm text-muted">
                      {formatSchoolName(l.schools.district)}
                    </p>
                  )}
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {(
                      [
                        ["Elementary", l.schools.elementary],
                        ["Middle", l.schools.middle],
                        ["High", l.schools.high],
                      ] as const
                    )
                      .filter(([, name]) => name)
                      .map(([level, name]) => (
                        <li
                          key={level}
                          className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4"
                        >
                          <School className="mt-0.5 size-5 shrink-0 text-brand-600" />
                          <div>
                            <p className="font-medium text-ink">{formatSchoolName(name!)}</p>
                            <p className="text-xs text-muted">{level}</p>
                          </div>
                        </li>
                      ))}
                  </ul>
                  <p className="mt-3 text-xs text-faint">
                    School assignments can change — verify with the district before you buy.
                  </p>
                </Section>
              )}

              {l.latitude !== null && l.longitude !== null && !l.hideAddress && (
                <Section title="Location">
                  <div className="h-80 overflow-hidden rounded-2xl border border-line">
                    <LocationMapLazy lat={l.latitude} lng={l.longitude} label={street} />
                  </div>
                  {neighborhood && inMarket && (
                    <Link
                      href={placeHref(neighborhood, l.county)}
                      className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                    >
                      More homes in {neighborhood} <ChevronRight className="size-4" />
                    </Link>
                  )}
                </Section>
              )}

              {/* IDX attribution: listing firm, Georgia MLS's required fields, source, copyright, disclaimer. */}
              <section
                className="mt-12 rounded-2xl bg-sunken/70 p-5 text-sm leading-relaxed text-ink-soft"
                aria-labelledby="listing-info"
                data-testid="listing-info"
              >
                <h2 id="listing-info" className="font-semibold text-ink">
                  Listing information
                </h2>
                <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                  <InfoRow label="Listing office" value={office ?? "Not provided"} />
                  {l.listAgentName && <InfoRow label="Listing agent" value={l.listAgentName} />}
                  <InfoRow label="Listing ID" value={l.mlsNumber ?? l.listingKey} />
                  <InfoRow label="Status" value={statusLabel(l.status, l.transactionType)} />
                  {attributionPhone && <InfoRow label="Contact phone" value={attributionPhone} />}
                  {attributionEmail && <InfoRow label="Contact email" value={attributionEmail} />}
                  {/* No buyer-broker compensation (Georgia MLS R&R Art. V): getListingBySlug
                      doesn't select it. */}
                </dl>
                <p className="mt-4">
                  Source: {source.name}
                  {source.lastSyncedAt
                    ? ` · Updated ${formatRelative(source.lastSyncedAt)}`
                    : l.updatedAt
                      ? ` · Updated ${formatRelative(l.updatedAt)}`
                      : ""}
                  {l.fromFeed && lastSynced ? ` · ${formatLastUpdated(lastSynced)}` : ""}
                </p>
                {l.fromFeed && <MlsAttribution className="mt-3" />}
                {disclaimer && <p className="mt-3 text-xs text-muted">{disclaimer}</p>}
                <Link
                  href={`/listing-corrections?listing=${encodeURIComponent(l.slug)}`}
                  className="mt-4 inline-flex min-h-10 items-center gap-1.5 font-medium text-brand-700 hover:underline"
                >
                  <Flag className="size-4" /> Report a listing problem
                </Link>
              </section>
            </div>

            {/* Contact sidebar */}
            <aside id="contact" className="scroll-mt-20 lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-3xl border border-line bg-surface p-6 shadow-card">
                {agent ? (
                  <div className="mb-5 flex items-center gap-4">
                    <Avatar
                      src={agent.photoUrl}
                      name={agent.name}
                      className="size-16 shrink-0 rounded-full text-xl"
                    />
                    <div className="min-w-0">
                      <p className="text-xs tracking-wide text-muted uppercase">Listing agent</p>
                      <Link
                        href={`/agents/${agent.slug}`}
                        className="block font-semibold text-ink hover:text-brand-700"
                      >
                        {agent.name}
                      </Link>
                      {agent.phone && (
                        // Tap to call: buyers on phones call.
                        <a
                          href={telHref(agent.phone)}
                          className="flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline pointer-fine:mt-0.5 pointer-fine:min-h-0"
                          data-testid="agent-phone"
                        >
                          {/* Agents without a direct line take calls at the office: say so. */}
                          {agent.phone === site.phone ? "Call the office" : "Call"}{" "}
                          <span className="whitespace-nowrap">{agent.phone}</span>
                        </a>
                      )}
                    </div>
                  </div>
                ) : tours ? (
                  <div className="mb-5">
                    <p className="font-display-tight text-xl text-ink">
                      See it with a local expert
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      An {site.name} agent can {home ? "tour this home" : "show you this property"}{" "}
                      with you — often same day — and tell you what the listing doesn&apos;t.
                    </p>
                  </div>
                ) : (
                  <div className="mb-5" data-out-of-area>
                    <h2 className="font-display-tight text-xl text-ink">Ask a question</h2>
                    <p className="mt-1 text-sm text-muted">
                      {site.name} is based in {site.address.city} and works mainly in{" "}
                      {site.market.region}. Send us your question about this home and our office
                      will get back to you.
                    </p>
                  </div>
                )}
                {l.removedAt ? (
                  <p className="text-sm text-muted">
                    This home is off the market. We can help you find similar ones.
                  </p>
                ) : (
                  <ContactForm
                    listingId={l.id}
                    source="listing"
                    compact
                    allowTour={!sold && tours}
                    today={marketToday()}
                    defaultMessage={`I'm interested in ${street}.`}
                    user={
                      session
                        ? {
                            name: session.user.name,
                            email: session.user.email,
                            phone: session.user.phone,
                          }
                        : null
                    }
                  />
                )}
              </div>
            </aside>
          </div>

          {similar.length > 0 && (
            <section className="mt-20" data-testid="similar-homes">
              <h2 className="mb-6 font-display-tight text-3xl font-medium text-ink">
                {home ? "Similar homes nearby" : "Similar properties nearby"}
              </h2>
              {/* First photo only, and not until the buyer scrolls near (site review #10). */}
              <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {similar.map((s) => (
                  <ListingCard
                    key={s.id}
                    listing={s}
                    sizes="(min-width: 1024px) 22vw, (min-width: 640px) 45vw, 92vw"
                    photoNearPx={SIMILAR_PHOTOS_NEAR_PX}
                  />
                ))}
              </div>
            </section>
          )}
        </Container>

        {/* Mobile CTA: hides while the form is on screen, and leads to it. */}
        {!l.removedAt && (
          <ListingCtaBar
            label={!tours ? "Ask a question" : sold ? "Ask about this home" : "Request a tour"}
            summary={
              <>
                <p className="font-semibold text-ink tabular">
                  {formatPrice(l.listPrice)}
                  {rent && "/mo"}
                </p>
                <p className="text-xs text-muted">
                  {bare ? landFacts(l) : `${l.bedrooms ?? "—"} bd · ${formatBaths(l.bathrooms)} ba`}
                </p>
              </>
            }
          />
        )}
      </main>
      <SiteFooter disclaimer={footerDisclaimer} />
    </>
  );
}

function StatusPill({ status, transactionType }: { status: string; transactionType: string }) {
  const color =
    status === "closed"
      ? "bg-status-sold"
      : status === "coming_soon"
        ? "bg-status-soon"
        : status === "pending" || status === "active_under_contract"
          ? "bg-status-pending"
          : "bg-status-active";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-ink">
      <span className={cn("size-2 rounded-full", color)} />
      {statusLabel(status, transactionType)}
    </span>
  );
}

/**
 * One of the strip's facts. The icon never shrinks, and a value too long for its cell
 * wraps inside it (`overflow-wrap: anywhere`, which also lets the text column shrink
 * below its longest word) rather than squeezing the icon or spilling out. Below 360px
 * the cell's padding tightens, so a home's "139.51 acres" still breaks only at its space
 * on a 280px phone (e2e/search-land-suite.ts).
 */
function BigFact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    // A valid <dl> group holds only a dt then a dd, so the icon sits in the dt, pinned to the
    // left padding (px + icon + gap), and flex-col-reverse shows the value above the label.
    <div className="relative flex flex-col-reverse justify-center bg-surface py-4 pr-3 pl-10 min-[360px]:pr-5 min-[360px]:pl-13 [&_svg]:absolute [&_svg]:top-1/2 [&_svg]:left-3 [&_svg]:size-5 [&_svg]:-translate-y-1/2 [&_svg]:text-brand-600 min-[360px]:[&_svg]:left-5">
      <dt className="text-xs text-muted">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="text-lg font-semibold [overflow-wrap:anywhere] text-ink tabular">{value}</dd>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line pb-3 [&_svg]:size-[18px] [&_svg]:text-faint">
      <dt className="flex items-center gap-3 text-sm text-muted">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="ml-auto text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted">{label}:</dt> <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-24">
      <h2 className="mb-5 font-display-tight text-2xl font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Similar homes' photos wait until the section is this close to the screen (site review #10). */
const SIMILAR_PHOTOS_NEAR_PX = 300;

// Parking, community, construction and utilities are listed under "Property details".
const FEATURE_GROUPS: [keyof ListingFeatures, string][] = [
  ["interior", "Interior"],
  ["appliances", "Appliances"],
  ["exterior", "Exterior"],
  ["heating", "Heating"],
  ["cooling", "Cooling"],
  ["flooring", "Flooring"],
  ["view", "View"],
  ["lot", "Lot"],
];

function FeatureSection({
  features,
  flags,
}: {
  features: ListingFeatures;
  flags: {
    hasPool: boolean;
    isWaterfront: boolean;
    hasBasement: boolean;
    isNewConstruction: boolean;
    isSingleStory: boolean;
  };
}) {
  // Guarded like "Property details": no excluded key or access value (lockbox, alarm code…).
  const safe = withoutExcludedFields(features ?? {});
  const groups = FEATURE_GROUPS.map(([k, label]) => [label, safe[k] ?? []] as const).filter(
    ([, items]) => items.length,
  );
  const highlights = [
    flags.hasPool && "Private pool",
    flags.isWaterfront && "Waterfront",
    flags.hasBasement && "Basement",
    flags.isNewConstruction && "New construction",
    flags.isSingleStory && "Single story",
  ].filter(Boolean) as string[];
  if (!groups.length && !highlights.length) return null;
  return (
    <Section title="Features">
      {highlights.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {highlights.map((h) => (
            <span
              key={h}
              className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800"
            >
              {h}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
        {groups.map(([label, items]) => (
          <div key={label}>
            <h3 className="text-xs font-semibold tracking-widest text-faint uppercase">{label}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{items.join(" · ")}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function eventLabel(e: ListingDetail["events"][number]): string {
  switch (e.type) {
    case "listed":
      return "Listed for sale";
    case "price_change":
      return e.price && e.previousPrice && e.price < e.previousPrice
        ? "Price decreased"
        : "Price increased";
    case "sold":
      return "Sold";
    case "relisted":
      return "Relisted";
    case "removed":
      return "Removed from market";
    case "status_change":
      return `Status: ${statusLabel(e.toStatus ?? "")}`;
  }
}

function JsonLd({ data }: { data: ListingDetail }) {
  const l = data.listing;
  // Bare land is a place, not a residence.
  const residenceType = isBareLand(l)
    ? "Place"
    : l.propertyType === "condo"
      ? "Apartment"
      : l.propertyType === "single_family"
        ? "SingleFamilyResidence"
        : "House";
  const json = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: formatFullAddress(l),
    url: `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")}/homes/${l.slug}`,
    datePosted: l.listDate ?? undefined,
    description: l.description ? redactAccessCodes(l.description) : undefined,
    image: data.media
      .filter((m) => m.kind === "photo")
      .slice(0, 8)
      .map((m) => m.url),
    offers: {
      "@type": "Offer",
      price: l.listPrice,
      priceCurrency: "USD",
      availability:
        l.status === "active" || l.status === "coming_soon"
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
    },
    about: {
      "@type": residenceType,
      address: l.hideAddress
        ? {
            "@type": "PostalAddress",
            addressLocality: l.city,
            addressRegion: normalizeState(l.state),
            postalCode: l.postalCode,
          }
        : {
            "@type": "PostalAddress",
            streetAddress: formatStreet(l),
            addressLocality: l.city,
            addressRegion: normalizeState(l.state),
            postalCode: l.postalCode,
          },
      numberOfBedrooms: l.bedrooms ?? undefined,
      numberOfBathroomsTotal: l.bathrooms ?? undefined,
      floorSize: l.livingAreaSqft
        ? { "@type": "QuantitativeValue", value: l.livingAreaSqft, unitCode: "FTK" }
        : undefined,
      yearBuilt: l.yearBuilt ?? undefined,
      geo:
        l.latitude && l.longitude && !l.hideAddress
          ? { "@type": "GeoCoordinates", latitude: l.latitude, longitude: l.longitude }
          : undefined,
    },
  };
  const breadcrumbs = listingBreadcrumbJsonLd(l, env.NEXT_PUBLIC_SITE_URL);
  return (
    <>
      <script
        type="application/ld+json"
        // Escaping "<" prevents a listing's text from closing the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, "\\u003c") }}
      />
    </>
  );
}
