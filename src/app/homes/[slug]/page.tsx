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
import type { ListingFeatures } from "@/db/schema";
import { offersTours } from "@/lib/areas/firm-area";
import { getActor, getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { cn } from "@/lib/cn";
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
  PROPERTY_TYPE_LABELS,
  statusLabel,
} from "@/lib/format";
import {
  formatAcres,
  formatPricePerAcre,
  isBareLand,
  isLandType,
  LAND_LOAN_NOTE,
  landFacts,
} from "@/lib/listings/land";
import { getListingBySlug, getSimilarListings, type ListingDetail } from "@/lib/listings/queries";
import { estimateMonthlyCost, financeFor, monthlyHoaAmount } from "@/lib/mortgage";
import { searchHref } from "@/lib/search/params";

export async function generateMetadata(props: PageProps<"/homes/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getListingBySlug(slug);
  if (!data) return { title: "Home not found" };
  const l = data.listing;
  const facts = isBareLand(l)
    ? l.lotSizeSqft
      ? landFacts(l).replace(" · ", ", ")
      : ""
    : [
        l.bedrooms !== null && `${l.bedrooms} bd`,
        l.bathrooms !== null && `${formatBaths(l.bathrooms)} ba`,
        l.livingAreaSqft && `${formatNumber(l.livingAreaSqft)} sqft`,
      ]
        .filter(Boolean)
        .join(", ");
  const title = `${formatFullAddress(l)} | ${facts ? `${facts} | ` : ""}${formatPrice(l.listPrice)}`;
  const description =
    l.description?.slice(0, 180) ??
    `${statusLabel(l.status, l.transactionType)} in ${l.city}, ${l.state}.`;
  return {
    title: { absolute: `${title} | ${site.name}` },
    description,
    alternates: { canonical: `/homes/${l.slug}` },
    openGraph: {
      title,
      description,
      images: l.primaryPhotoUrl ? [{ url: l.primaryPhotoUrl }] : undefined,
    },
    // IDX: off-market listings stay reachable for people who saved them, but shouldn't be indexed.
    robots: l.removedAt ? { index: false } : undefined,
  };
}

export default async function ListingPage(props: PageProps<"/homes/[slug]">) {
  const { slug } = await props.params;
  const data = await getListingBySlug(slug);
  if (!data) notFound();
  const { listing: l, media, openHouses, events, agent, source } = data;
  const [similar, session, actor] = await Promise.all([
    getSimilarListings(l),
    getSession(),
    getActor(),
  ]);

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
  // Insurance and the tax fallback follow the county (coastal and metro rates differ).
  const finance = financeFor(l.county);
  const estimate = estimateMonthlyCost({
    price: l.listPrice,
    downPaymentPct: finance.downPaymentPct,
    interestRatePct: finance.interestRate,
    loanTermYears: finance.loanTermYears,
    annualTax: l.taxAnnualAmount || (l.listPrice * finance.propertyTaxRatePct) / 100,
    annualInsurance: bare ? 0 : (l.listPrice * finance.insuranceRatePct) / 100,
    monthlyHoa,
    noMortgageInsurance: bare,
  });
  // Tours only where our agents work (or on our own listings); elsewhere, a question to the office.
  const tours = offersTours(l);
  const dom = daysSince(l.listDate);
  const street = formatStreet(l);
  const canEdit = can.editListing(actor, { sourceKind: source.kind, listAgentId: l.listAgentId });
  // IDX: the listing firm, named prominently (the firm's own listings may carry no office name).
  const office = l.listOfficeName ?? (l.isCompanyListing ? site.legalName : null);

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
            listOfficeName: l.listOfficeName,
            transactionType: l.transactionType,
            status: l.status,
          }}
        />
        <Container className="pt-5">
          {l.removedAt && (
            <p className="mb-4 rounded-2xl bg-clay-50 px-4 py-3 text-sm text-clay-600">
              This home is no longer on the market.{" "}
              <Link
                href={searchHref({ q: l.neighborhood ?? l.city })}
                className="font-semibold underline"
              >
                See similar homes nearby
              </Link>
              .
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
                <ChevronRight className="size-3.5" />
                <Link href={searchHref({ q: l.city })} className="hover:text-ink">
                  {l.city}
                </Link>
                {l.neighborhood && l.neighborhood !== l.city && (
                  <>
                    <ChevronRight className="size-3.5" />
                    <Link href={searchHref({ q: l.neighborhood })} className="hover:text-ink">
                      {l.neighborhood}
                    </Link>
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
                {!rent && !sold && (
                  <a href="#costs" className="group text-right" data-testid="estimate-pill">
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

              <dl
                className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4"
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
                      {l.description}
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
                  <Fact
                    icon={<DollarSign />}
                    label="HOA"
                    value={
                      l.hoaFee
                        ? `${formatPrice(l.hoaFee)}/${l.hoaFrequency === "annually" ? "yr" : l.hoaFrequency === "quarterly" ? "qtr" : "mo"}`
                        : "None"
                    }
                  />
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
                      label={`Property tax${l.taxYear ? ` (${l.taxYear})` : ""}`}
                      value={`${formatPrice(l.taxAnnualAmount)}/yr`}
                    />
                  ) : null}
                  <Fact icon={<Clock />} label="Listed" value={formatDate(l.listDate)} />
                  {l.mlsNumber && <Fact icon={<Hash />} label="MLS #" value={l.mlsNumber} />}
                </dl>
              </Section>

              <FeatureSection features={l.features} flags={l} />

              {!rent && !sold && (
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
                    <p className="mb-4 text-sm text-muted">{l.schools.district}</p>
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
                            <p className="font-medium text-ink">{name}</p>
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
                  {l.neighborhood && (
                    <Link
                      href={searchHref({ q: l.neighborhood })}
                      className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                    >
                      More homes in {l.neighborhood} <ChevronRight className="size-4" />
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
                  {l.attributionPhone && (
                    <InfoRow label="Contact phone" value={l.attributionPhone} />
                  )}
                  {l.attributionEmail && (
                    <InfoRow label="Contact email" value={l.attributionEmail} />
                  )}
                  {l.variableCompensation !== null && (
                    <InfoRow
                      label="Variable compensation"
                      value={l.variableCompensation ? "Yes" : "No"}
                    />
                  )}
                  {l.buyerAgencyCompensation && (
                    <div className="space-y-2 sm:col-span-2" data-testid="buyer-compensation">
                      <InfoRow
                        label="Buyer agency compensation"
                        value={l.buyerAgencyCompensation}
                      />
                      <InfoRow
                        label="Compensation comments"
                        value={l.compensationComments ?? "None"}
                      />
                    </div>
                  )}
                </dl>
                <p className="mt-4">
                  Source: {source.name}
                  {source.lastSyncedAt
                    ? ` · Updated ${formatRelative(source.lastSyncedAt)}`
                    : l.updatedAt
                      ? ` · Updated ${formatRelative(l.updatedAt)}`
                      : ""}
                </p>
                {l.fromFeed && <MlsAttribution className="mt-3" />}
                {source.disclaimer && (
                  <p className="mt-3 text-xs text-muted">{source.disclaimer}</p>
                )}
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
                      className="size-16 rounded-full text-xl"
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
                          Call {agent.phone}
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
            <section className="mt-20">
              <h2 className="mb-6 font-display-tight text-3xl font-medium text-ink">
                {home ? "Similar homes nearby" : "Similar properties nearby"}
              </h2>
              <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {similar.map((s) => (
                  <ListingCard key={s.id} listing={s} />
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
      <SiteFooter disclaimer={source.disclaimer} />
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

function BigFact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 bg-surface px-5 py-4 [&_svg]:size-5 [&_svg]:text-brand-600">
      {icon}
      <div>
        <dd className="text-lg font-semibold text-ink tabular">{value}</dd>
        <dt className="text-xs text-muted">{label}</dt>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line pb-3 [&_svg]:size-[18px] [&_svg]:text-faint">
      {icon}
      <dt className="text-sm text-muted">{label}</dt>
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

const FEATURE_GROUPS: [keyof ListingFeatures, string][] = [
  ["interior", "Interior"],
  ["appliances", "Appliances"],
  ["exterior", "Exterior"],
  ["parking", "Parking"],
  ["heating", "Heating"],
  ["cooling", "Cooling"],
  ["flooring", "Flooring"],
  ["community", "Community"],
  ["view", "View"],
  ["construction", "Construction"],
  ["lot", "Lot"],
  ["utilities", "Utilities"],
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
  const groups = FEATURE_GROUPS.map(([k, label]) => [label, features[k] ?? []] as const).filter(
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
    url: `/homes/${l.slug}`,
    datePosted: l.listDate ?? undefined,
    description: l.description ?? undefined,
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
            addressRegion: l.state,
            postalCode: l.postalCode,
          }
        : {
            "@type": "PostalAddress",
            streetAddress: formatStreet(l),
            addressLocality: l.city,
            addressRegion: l.state,
            postalCode: l.postalCode,
          },
      numberOfRooms: l.bedrooms ?? undefined,
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
  return (
    <script
      type="application/ld+json"
      // Escaping "<" prevents a listing's text from closing the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, "\\u003c") }}
    />
  );
}
