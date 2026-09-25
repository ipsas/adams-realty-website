import { ArrowRight, House, Search, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactMethods } from "@/components/content/contact-methods";
import { ContactForm } from "@/components/listings/contact-form";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Contact us",
  description: `Call, email or message ${site.name}. Talk to a local ${site.market.region} real estate agent about buying, selling or renting a home.`,
  alternates: { canonical: "/contact" },
};

const SHORTCUTS = [
  {
    icon: House,
    title: "What's my home worth?",
    body: "Get a free, no-obligation valuation from a local agent.",
    href: "/sell#valuation",
  },
  {
    icon: UsersRound,
    title: "Find an agent",
    body: "Browse our team and message an agent directly.",
    href: "/agents",
  },
  {
    icon: Search,
    title: "Search homes",
    body: `Homes for sale and for rent across ${site.market.region}.`,
    href: "/homes",
  },
];

/* Mirrors createInquiry: contact-page messages have no agent, so they land in the brokerage inbox for routing. */
const NEXT_STEPS = [
  { title: "It reaches our office", body: "Your message goes to our team, not a call center." },
  { title: "We find the right agent", body: "Someone who knows the area and what you need." },
  { title: "They reply directly", body: `Your details stay with ${site.name} — never sold.` },
];

export default async function ContactPage() {
  const session = await getSession();

  return (
    <>
      <section className="relative isolate overflow-hidden bg-brand-900 text-white">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_85%_-10%,rgb(200_155_90/0.16),transparent_60%),radial-gradient(40rem_24rem_at_0%_110%,rgb(47_117_88/0.35),transparent_65%)]"
        />
        {/* Three grid items so phones get intro → form → next steps, while desktop keeps the form beside both. */}
        <Container className="grid grid-cols-1 gap-12 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-x-16 lg:py-24 xl:grid-cols-[minmax(0,1fr)_30rem]">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brass-400 uppercase">
              <span className="h-px w-8 bg-brass-400" />
              Contact
            </p>
            <h1 className="max-w-xl font-display-tight text-4xl leading-[1.05] font-normal sm:text-5xl lg:text-6xl">
              Let&apos;s talk about <em className="font-light text-brass-100">home.</em>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              Questions about a listing, a neighborhood or selling your house? Call, email or send a
              message — it comes straight to our office, and we&apos;ll connect you with the right
              agent.
            </p>
            <ContactMethods tone="dark" className="mt-10 max-w-2xl" />
          </div>

          <div
            id="message"
            className="scroll-mt-24 self-start rounded-3xl bg-surface p-6 text-ink shadow-pop sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1"
          >
            <h2 className="font-display-tight text-2xl font-medium">Send us a message</h2>
            <p className="mt-1 mb-6 text-sm text-muted">
              Tell us what you&apos;re looking for and how to reach you.
            </p>
            <ContactForm
              source="contact"
              allowTour={false}
              compact
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
          </div>

          <div className="max-w-2xl border-t border-white/10 pt-8 lg:col-start-1 lg:row-start-2">
            <h2 className="text-xs font-semibold tracking-widest text-white/55 uppercase">
              What happens next
            </h2>
            <ol className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
              {NEXT_STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3 sm:flex-col">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brass-400/15 text-xs font-semibold text-brass-400 tabular">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{step.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-white/60">
                      {step.body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </section>

      <section className="pt-20 pb-4 sm:pt-24">
        <Container>
          <h2 className="font-display-tight text-3xl font-medium text-ink sm:text-4xl">
            Looking for something specific?
          </h2>
          <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            {SHORTCUTS.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="group flex h-full flex-col rounded-3xl bg-surface p-7 ring-1 ring-line transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-lift sm:p-8"
                >
                  <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                    <s.icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="mt-5 text-lg font-semibold text-ink">{s.title}</span>
                  <span className="mt-1.5 flex-1 text-[0.9375rem] leading-relaxed text-muted">
                    {s.body}
                  </span>
                  <ArrowRight className="mt-6 size-5 text-brand-700 transition-transform group-hover:translate-x-1" />
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-12 max-w-3xl text-sm leading-relaxed text-muted">
            Need help using this site, or an accommodation because of a disability? See our{" "}
            <Link
              href="/accessibility"
              className="font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              accessibility statement
            </Link>
            . Questions about equal treatment? Read our{" "}
            <Link
              href="/fair-housing"
              className="font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              fair housing commitment
            </Link>
            . To ask about your data, see the{" "}
            <Link
              href="/privacy#your-choices"
              className="font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              privacy policy
            </Link>
            .
          </p>
        </Container>
      </section>
    </>
  );
}
