import { Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { telHref } from "@/components/content/contact";
import { MlsAttribution } from "@/components/content/mls-attribution";
import { PageIntro } from "@/components/content/page-intro";
import { ContactForm } from "@/components/listings/contact-form";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { getSession } from "@/lib/auth/session";
import { formatFullAddress } from "@/lib/format";
import { getListingForReport } from "@/lib/listings/queries";

export const metadata: Metadata = {
  title: "Report a listing problem",
  description: `How Georgia MLS, listing agents and visitors report a listing with wrong information on ${site.name}. We correct or remove it within one business day.`,
  alternates: { canonical: "/listing-corrections" },
};

/**
 * The published corrections process the Georgia MLS IDX agreement asks for
 * (Exhibit A §6): a direct phone and a dedicated email, plus a form that
 * reaches the office. Every listing page links here with `?listing=<slug>`.
 */
export default async function ListingCorrectionsPage(props: PageProps<"/listing-corrections">) {
  const { listing: slug } = await props.searchParams;
  const [listing, session] = await Promise.all([
    typeof slug === "string" ? getListingForReport(slug) : null,
    getSession(),
  ]);
  const { email, phone } = site.mls.corrections;
  const label = listing
    ? `${formatFullAddress(listing)}${listing.mlsNumber ? ` (MLS #${listing.mlsNumber})` : ""}`
    : null;
  const subject = `Listing problem${label ? `: ${label}` : ""}`;

  return (
    <>
      <PageIntro
        eyebrow="Listing corrections"
        title="Report a listing problem"
        lead={`If a listing on ${site.name} has the wrong status, price, photos or any other wrong information, tell our office. We correct it, or take it down, within one business day, and a listing taken down for Georgia MLS stays down until Georgia MLS confirms it.`}
      />
      <Container className="grid grid-cols-1 gap-12 py-12 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-16">
        <div className="min-w-0 space-y-8">
          {label && (
            <p
              className="rounded-2xl border border-line bg-surface p-4 text-ink"
              data-testid="reported-listing"
            >
              <span className="text-sm text-muted">Listing: </span>
              <span className="font-medium">{label}</span>
            </p>
          )}
          <section aria-labelledby="direct">
            <h2 id="direct" className="font-display-tight text-2xl text-ink">
              Reach the office directly
            </h2>
            <p className="mt-2 text-muted">
              For Georgia MLS staff, listing agents and brokers, and anyone who spots a mistake.
              Please include the address or MLS number.
            </p>
            <ul className="mt-5 space-y-3">
              <li>
                <a
                  href={telHref(phone)}
                  className="inline-flex min-h-11 items-center gap-3 font-medium text-brand-700 hover:underline"
                >
                  <Phone className="size-5" aria-hidden /> {phone}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}
                  className="inline-flex min-h-11 items-center gap-3 font-medium break-all text-brand-700 hover:underline"
                  data-testid="corrections-email"
                >
                  <Mail className="size-5 shrink-0" aria-hidden /> {email}
                </a>
              </li>
            </ul>
          </section>
          <section aria-labelledby="what-happens">
            <h2 id="what-happens" className="font-display-tight text-2xl text-ink">
              What happens next
            </h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-ink-soft">
              <li>Our office checks the listing against Georgia MLS the same business day.</li>
              <li>
                Wrong information is corrected, or the listing is removed, within one business day
                of your report.
              </li>
              <li>We reply to tell you what we changed.</li>
            </ol>
          </section>
          <div className="text-xs text-muted">
            <MlsAttribution />
          </div>
          <p className="text-sm text-muted">
            Looking for a home instead?{" "}
            <Link href="/homes" className="font-medium text-brand-700 hover:underline">
              Search homes
            </Link>
          </p>
        </div>
        <aside className="rounded-3xl border border-line bg-surface p-6 shadow-card lg:self-start">
          <h2 className="font-display-tight text-xl text-ink">Send a report</h2>
          <p className="mt-1 mb-5 text-sm text-muted">It goes straight to our office.</p>
          <ContactForm
            source="report"
            listingId={listing?.id}
            allowTour={false}
            defaultMessage={label ? `Problem with ${label}: ` : "Problem with the listing at "}
            user={
              session
                ? { name: session.user.name, email: session.user.email, phone: session.user.phone }
                : null
            }
          />
        </aside>
      </Container>
    </>
  );
}
