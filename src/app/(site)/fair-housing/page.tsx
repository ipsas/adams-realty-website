import { ArrowUpRight, Ban, HandHeart, Home, Mail, Phone, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { mailtoHref, telHref } from "@/components/content/contact";
import { EqualHousingLogo } from "@/components/content/equal-housing-logo";
import { PageIntro } from "@/components/content/page-intro";
import { buttonClasses } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/section";
import { site } from "@/config/site";

/*
 * General information, not legal advice; have counsel review before launch.
 * Protected classes are those of the federal Fair Housing Act (42 U.S.C. §3604)
 * and the Georgia Fair Housing Act (O.C.G.A. §8-3-200 et seq.), which match.
 * TODO(adams): re-check the HUD and GCEO links and the HUD hotline before
 * launch — agency sites get reorganized.
 */

export const metadata: Metadata = {
  title: "Fair housing",
  description: `${site.legalName} is committed to equal housing opportunity under the federal Fair Housing Act and the Georgia Fair Housing Act. Learn your rights and how to report discrimination.`,
  alternates: { canonical: "/fair-housing" },
};

const HUD_COMPLAINT_URL = "https://www.hud.gov/fairhousing/fileacomplaint";
const HUD_HOTLINE = "1-800-669-9777";
const GCEO_URL = "https://gceo.georgia.gov/";

const PROTECTED = [
  "Race",
  "Color",
  "Religion",
  "Sex",
  "National origin",
  "Familial status",
  "Disability",
];

const DEFINITIONS = [
  {
    term: "Familial status",
    detail:
      "Households with children under 18, pregnant people, and anyone securing custody of a child.",
  },
  {
    term: "Disability",
    detail:
      "Physical or mental — including the right to reasonable accommodations and modifications.",
  },
  { term: "Sex", detail: "Includes sexual harassment in housing." },
  { term: "National origin", detail: "Includes ancestry and where you or your family are from." },
];

const PROHIBITED = [
  "Refusing to sell, rent or negotiate, or saying a home isn't available when it is",
  "Setting different prices, terms, conditions or services",
  "Steering buyers or renters toward or away from neighborhoods",
  "Advertising that states or implies a preference or limitation",
  "Pressuring owners to sell by suggesting who is moving into a neighborhood",
  "Refusing reasonable accommodations or modifications for a person with a disability",
  "Discriminating in mortgage lending or appraisals",
  "Threatening, intimidating or retaliating against anyone who exercises fair housing rights",
];

const COMMITMENTS = [
  {
    icon: Scale,
    title: "Equal service for everyone",
    body: "Every client gets the same information, the same access to listings and the same attention from our agents.",
  },
  {
    icon: Home,
    title: "We describe homes, not people",
    body: "We talk about homes and places — features, prices, commutes and amenities — never who does or should live there. Search on this site filters by property details only.",
  },
  {
    icon: HandHeart,
    title: "Accommodations on request",
    body: "If you have a disability and need an accommodation to use this site or to work with us, just ask.",
    link: { href: "/accessibility", label: "Accessibility" },
  },
];

export default function FairHousingPage() {
  return (
    <>
      <PageIntro
        eyebrow="Fair housing"
        title={
          <>
            Fair housing is the law — <em className="font-light">and how we work.</em>
          </>
        }
        lead={`${site.legalName} is committed to equal housing opportunity. We follow the federal Fair Housing Act and the Georgia Fair Housing Act, and we welcome every buyer, seller and renter.`}
        aside={
          <div className="flex lg:justify-end">
            <EqualHousingLogo withText className="w-20 text-brand-800 sm:w-24 lg:w-36" />
          </div>
        }
      />

      {/* Policy + protected classes */}
      <section className="py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-20">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-700 uppercase">
                Our policy
              </p>
              <h2 className="font-display-tight text-3xl font-medium text-ink sm:text-4xl">
                Equal professional service, for everyone
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-ink-soft">
                It is the policy of {site.legalName} to provide equal professional service without
                regard to race, color, religion, sex, disability, familial status or national origin
                — or any other characteristic protected by federal, state or local law.
              </p>
              <p className="mt-4 leading-relaxed text-muted">
                That applies to how we show and sell homes, the information we share, the listings
                we advertise and the terms we offer — whether you&apos;re buying, selling or
                renting.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Under federal and Georgia law, housing discrimination is illegal because of:
              </h3>
              <ul className="mt-5 flex flex-wrap gap-2.5">
                {PROTECTED.map((p) => (
                  <li
                    key={p}
                    className="rounded-full bg-surface px-5 py-2.5 font-display-tight text-xl text-ink ring-1 ring-line"
                  >
                    {p}
                  </li>
                ))}
              </ul>
              <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 border-t border-line pt-8 sm:grid-cols-2">
                {DEFINITIONS.map((d) => (
                  <div key={d.term}>
                    <dt className="text-sm font-semibold text-ink">{d.term}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted">{d.detail}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-8 rounded-2xl bg-brand-50 px-5 py-4 text-sm leading-relaxed text-brand-800 ring-1 ring-brand-100">
                <strong className="font-semibold">Local protections.</strong> Some Georgia cities
                and counties protect additional groups. We honor those laws wherever we work.
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* Prohibited practices */}
      <section className="border-y border-line bg-sunken/60 py-20 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow="Know your rights"
            title="What fair housing law prohibits"
            description="These practices are illegal when they're based on a protected characteristic — whoever does them."
          />
          <ul className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
            {PROHIBITED.map((p) => (
              <li
                key={p}
                className="flex items-start gap-3 border-b border-line pb-4 text-[0.9375rem] leading-relaxed text-ink-soft"
              >
                <Ban className="mt-0.5 size-5 shrink-0 text-clay-500" strokeWidth={1.75} />
                {p}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Reporting */}
      <section id="report" className="scroll-mt-16 bg-brand-900 py-20 text-white sm:py-24">
        <Container>
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-400 uppercase">
              Report discrimination
            </p>
            <h2 className="font-display-tight text-3xl font-normal sm:text-4xl">
              If you believe you&apos;ve been treated unfairly
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-white/70">
              You can file a complaint with HUD or the Georgia Commission on Equal Opportunity. You
              don&apos;t need to contact us first, and reporting to us doesn&apos;t replace your
              right to go to either agency.
            </p>
          </div>

          <ul className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-white/10 lg:grid-cols-3 lg:grid-rows-[repeat(4,auto)]">
            <ReportCard
              kicker="Federal"
              title="U.S. Department of Housing and Urban Development (HUD)"
              body="HUD's Office of Fair Housing and Equal Opportunity investigates complaints under the federal Fair Housing Act. Complaints generally must be filed within one year of the last incident."
              actions={
                <>
                  <a
                    href={HUD_COMPLAINT_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClasses("inverse", "md")}
                  >
                    File a complaint with HUD <ArrowUpRight />
                  </a>
                  <a
                    href={telHref(HUD_HOTLINE)}
                    className={buttonClasses(
                      "ghost",
                      "md",
                      "text-white hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Phone /> {HUD_HOTLINE}
                  </a>
                </>
              }
            />
            <ReportCard
              kicker="Georgia"
              title="Georgia Commission on Equal Opportunity"
              body="The Commission's Fair Housing Division enforces the Georgia Fair Housing Act and investigates housing discrimination complaints across the state."
              actions={
                <a
                  href={GCEO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClasses("inverse", "md")}
                >
                  Visit gceo.georgia.gov <ArrowUpRight />
                </a>
              }
            />
            <ReportCard
              kicker={site.name}
              title={`Tell ${site.name}`}
              body={`If you believe anyone at ${site.name} treated you unfairly, contact our office. We take every concern seriously.`}
              actions={
                <>
                  <a href={telHref(site.phone)} className={buttonClasses("inverse", "md")}>
                    <Phone /> {site.phone}
                  </a>
                  <a
                    href={mailtoHref(site.email, "Fair housing concern")}
                    className={buttonClasses(
                      "ghost",
                      "md",
                      "text-white hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Mail /> Email us
                  </a>
                </>
              }
            />
          </ul>

          <p className="mt-8 text-sm text-white/55">
            This page is general information about fair housing law, not legal advice.
          </p>
        </Container>
      </section>
      {/* Commitments */}
      <section className="pt-20 pb-4 sm:pt-24">
        <Container>
          <SectionHeading eyebrow="In practice" title={`How ${site.name} puts this to work`} />
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            {COMMITMENTS.map((c) => (
              <li
                key={c.title}
                className="flex flex-col rounded-3xl bg-surface p-7 ring-1 ring-line sm:p-8"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <c.icon className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-ink">{c.title}</h3>
                <p className="mt-2 flex-1 text-[0.9375rem] leading-relaxed text-muted">{c.body}</p>
                {c.link && (
                  <Link
                    href={c.link.href}
                    className="mt-5 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800"
                  >
                    {c.link.label} <ArrowUpRight className="size-4" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Container>
      </section>
    </>
  );
}

function ReportCard({
  kicker,
  title,
  body,
  actions,
}: {
  kicker: string;
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    // Subgrid rows line up the titles, text and buttons across the three cards on desktop.
    <li className="flex flex-col bg-brand-900 p-7 sm:p-8 lg:row-span-4 lg:grid lg:grid-rows-subgrid lg:gap-y-0">
      <p className="text-xs font-semibold tracking-[0.18em] text-brass-400 uppercase">{kicker}</p>
      <h3 className="mt-3 text-xl font-semibold text-white">{title}</h3>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-white/70">{body}</p>
      <div className="mt-7 flex flex-wrap content-start gap-2">{actions}</div>
    </li>
  );
}
