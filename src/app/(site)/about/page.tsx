import {
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  EyeOff,
  MapPinned,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { addressLines } from "@/components/content/contact";
import { ContactCta } from "@/components/content/contact-cta";
import { PageIntro } from "@/components/content/page-intro";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { Container, SectionHeading } from "@/components/ui/section";
import { site } from "@/config/site";
import { getAgents } from "@/lib/agents/queries";

/*
 * Only statements that are true by construction belong on this page: what the
 * site itself does, and facts from src/config/site.ts or the database. No
 * founding story, sales figures, awards or testimonials until the company
 * supplies (and can substantiate) them.
 */

export const metadata: Metadata = {
  title: "About us",
  description: `${site.legalName} is a Georgia real estate brokerage serving ${site.market.region}. No ads, no selling your information — local agents and the full picture on every home.`,
  alternates: { canonical: "/about" },
};

const COMMITMENTS = [
  {
    icon: EyeOff,
    title: "No ads. Ever.",
    body: "No sponsored listings, no pop-ups and no paid “premier agent” placements. You see homes, in the order you asked for.",
  },
  {
    icon: ShieldCheck,
    title: "Your information stays here",
    body: `We never sell your details or pass them to agents outside ${site.name}. A message you send reaches one of our agents — not a bidding war of strangers.`,
  },
  {
    icon: BadgeDollarSign,
    title: "The full monthly cost",
    body: "Every home shows an estimate with property taxes, homeowners insurance, HOA dues and mortgage insurance — not just principal and interest.",
  },
  {
    icon: RefreshCcw,
    title: "Straight from the MLS",
    body: "Listings refresh from the MLS every 15 minutes, and every home credits the brokerage that listed it.",
  },
  {
    icon: MapPinned,
    title: "Local agents",
    body: `Questions go to ${site.name} agents who work in ${site.market.region} — not a call center or a referral network.`,
  },
];

const BUYING = [
  {
    title: "Search every listing",
    body: "Filter by what matters, search on the map, and see the real monthly cost of each home.",
  },
  {
    title: "Save homes and searches",
    body: "A free account keeps your favorites and emails you when new matches list or a price drops.",
  },
  {
    title: "Tour with a local agent",
    body: "Request an in-person or video tour right from the listing, and an agent confirms the details with you.",
  },
  {
    title: "Offer to closing",
    body: "Your agent helps you shape a strong offer, then guides inspections, appraisal and closing.",
  },
];

const SELLING = [
  {
    title: "Get a free valuation",
    body: "Tell us about your home and a local agent prepares a no-obligation opinion of its value.",
  },
  {
    title: "Price it right",
    body: "A pricing plan built from recent comparable sales in your neighborhood, not an algorithm's guess.",
  },
  {
    title: "Market it well",
    body: "Listed on the MLS so it reaches buyers' agents and home-search sites — and shown here, where buyers see no ads.",
  },
  {
    title: "Negotiate to close",
    body: "Offer strategy, inspections, appraisal and closing, with one agent keeping you posted at every step.",
  },
];

const ROUTING = [
  {
    title: "You send a question or tour request",
    body: "From a listing, an agent's profile, our selling page or the contact form.",
  },
  {
    title: "It goes to one person",
    body: "The home's listing agent, the agent you picked, or our office, which assigns a local agent.",
  },
  {
    title: "That agent replies directly",
    body: `Your details stay inside ${site.name}. They're never sold, and never shared for advertising.`,
  },
];

export default async function AboutPage() {
  const agents = await getAgents();
  const based = addressLines(site.address).join(" · ");

  const glance = [
    { label: "Company", value: site.legalName },
    {
      label: "Licensed by",
      value: site.brokerLicense
        ? `Georgia Real Estate Commission · Firm license ${site.brokerLicense}`
        : "Georgia Real Estate Commission",
    },
    { label: "Based in", value: based },
    { label: "Serving", value: `${site.market.region} and across ${site.market.stateName}` },
    ...(agents.length > 0
      ? [
          {
            label: "Our team",
            value: `${agents.length} local agent${agents.length === 1 ? "" : "s"}`,
          },
        ]
      : []),
    { label: "Office hours", value: site.hours },
  ];

  return (
    <>
      <PageIntro
        tone="dark"
        eyebrow={`About ${site.name}`}
        title={
          <>
            We sell homes, <em className="font-light text-brass-100">not your attention.</em>
          </>
        }
        lead={`${site.legalName} is a Georgia real estate brokerage helping people buy, sell and rent homes across ${site.market.region}. We built this site to work the way we do: straightforward, local and on your side.`}
        aside={
          <dl className="divide-y divide-white/10 rounded-3xl bg-white/[0.04] px-6 py-2 ring-1 ring-white/10 backdrop-blur-sm sm:px-8">
            {glance.map((g) => (
              <div key={g.label} className="grid grid-cols-1 gap-1 py-4 sm:grid-cols-[8rem_1fr]">
                <dt className="text-xs font-semibold tracking-widest text-white/55 uppercase sm:pt-0.5">
                  {g.label}
                </dt>
                <dd className="text-[0.9375rem] font-medium text-white">{g.value}</dd>
              </div>
            ))}
          </dl>
        }
      >
        <LinkButton href="/contact" size="lg" variant="inverse">
          Talk to us
        </LinkButton>
        <LinkButton
          href="/agents"
          size="lg"
          variant="ghost"
          className="text-white hover:bg-white/10 hover:text-white"
        >
          Meet our agents <ArrowRight />
        </LinkButton>
      </PageIntro>

      {/* Commitments */}
      <section className="py-20 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow="Our commitments"
            title="Promises built into the site"
            description="They're part of how the site works, not fine print — so you can hold us to them."
          />
          <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-line ring-1 ring-line sm:grid-cols-2 lg:grid-cols-3">
            {COMMITMENTS.map((c) => (
              <li key={c.title} className="bg-surface p-7 sm:p-8">
                <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <c.icon className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-ink">{c.title}</h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{c.body}</p>
              </li>
            ))}
            <li className="bg-brand-900">
              <Link
                href="/privacy"
                className="group flex h-full flex-col justify-between gap-8 p-7 text-white transition-colors hover:bg-brand-800 sm:p-8"
              >
                <span className="text-xs font-semibold tracking-[0.18em] text-brass-400 uppercase">
                  In writing
                </span>
                <span>
                  <span className="block font-display-tight text-2xl font-normal">
                    Read how we handle your information
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-white/75 group-hover:text-white">
                    Privacy policy
                    <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </span>
              </Link>
            </li>
          </ul>
        </Container>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-sunken/60 py-20 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="Buying or selling with us"
            description="The same straightforward approach, whichever side of the table you're on."
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Steps
              title="Buying a home"
              steps={BUYING}
              cta={{ href: "/homes", label: "Start your search" }}
            />
            <Steps
              title="Selling a home"
              steps={SELLING}
              cta={{ href: "/sell", label: "How we sell homes" }}
            />
          </div>

          <div className="mt-16">
            <h3 className="font-display-tight text-2xl font-medium text-ink sm:text-3xl">
              What happens when you reach out
            </h3>
            <ol className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
              {ROUTING.map((r, i) => (
                <li key={r.title} className="relative md:pr-6">
                  <div className="flex items-center gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white tabular">
                      {i + 1}
                    </span>
                    {i < ROUTING.length - 1 && (
                      <span aria-hidden className="hidden h-px flex-1 bg-line-strong md:block" />
                    )}
                  </div>
                  <p className="mt-4 font-semibold text-ink">{r.title}</p>
                  <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">{r.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </section>

      {/* Team */}
      {agents.length > 0 && (
        <section className="py-20 sm:py-24">
          <Container>
            <SectionHeading
              eyebrow="Our team"
              title="The people you'll work with"
              description="Meet the agents behind our listings, and reach any of them directly from their profile."
              action={
                <LinkButton href="/agents" variant="secondary">
                  {agents.length > 4 ? `Meet all ${agents.length} agents` : "Meet the team"}{" "}
                  <ArrowRight />
                </LinkButton>
              }
            />
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-6 lg:grid-cols-4">
              {agents.slice(0, 4).map((a) => (
                <Link key={a.id} href={`/agents/${a.slug}`} className="group min-w-0">
                  <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-sunken">
                    <Avatar
                      src={a.photoUrl}
                      name={a.name}
                      className="size-full text-5xl transition-transform duration-700 group-hover:scale-105"
                    />
                  </div>
                  <p className="mt-3 font-semibold text-ink group-hover:text-brand-700">{a.name}</p>
                  {a.title && <p className="text-sm text-muted">{a.title}</p>}
                  {a.serviceAreas.length > 0 && (
                    <p className="mt-1 truncate text-xs text-faint">
                      {a.serviceAreas.slice(0, 3).join(" · ")}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </Container>
        </section>
      )}

      <ContactCta
        title="Questions? Talk to a real person."
        body={`Whether you're just starting to look or ready to list, a ${site.name} agent is happy to help — no pressure and no obligation.`}
      />
    </>
  );
}

function Steps({
  title,
  steps,
  cta,
}: {
  title: string;
  steps: { title: string; body: string }[];
  cta: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col rounded-3xl bg-surface p-7 shadow-card ring-1 ring-line sm:p-10">
      <h3 className="font-display-tight text-2xl font-medium text-ink sm:text-3xl">{title}</h3>
      <ol className="mt-8 flex-1 space-y-6">
        {steps.map((s, i) => (
          <li key={s.title} className="grid grid-cols-[2.25rem_1fr] gap-4">
            <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 tabular">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="font-semibold text-ink">{s.title}</p>
              <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8 border-t border-line pt-6">
        <Link
          href={cta.href}
          className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800"
        >
          {cta.label} <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
