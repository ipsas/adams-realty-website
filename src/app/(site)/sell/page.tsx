import { Camera, ChartNoAxesCombined, Handshake, Megaphone } from "lucide-react";
import type { Metadata } from "next";
import { ValuationForm } from "@/components/sell/valuation-form";
import { Photo } from "@/components/ui/photo";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Sell your home",
  description: `Sell your ${site.market.region} home, land, farm or lake property with ${site.legalName} in ${site.address.city}. Start with a free, no-obligation valuation from a local agent.`,
};

const IMAGE =
  "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1600&q=80";

const STEPS = [
  {
    icon: ChartNoAxesCombined,
    title: "Price it right",
    body: "A walk-through and a pricing plan built from recent comparable sales nearby — not a zestimate.",
  },
  {
    icon: Camera,
    title: "Show it well",
    body: "Photos and a description that show buyers what matters — the house, the land, the water or the business location.",
  },
  {
    icon: Megaphone,
    title: "Reach buyers",
    body: `Listed on ${site.mls.name}, so it reaches buyers' agents and the home-search sites that show MLS listings — and featured here, where buyers don't see ads.`,
  },
  {
    icon: Handshake,
    title: "Negotiate to close",
    body: "Offer strategy, inspections, appraisal and closing — one agent keeps you posted at every step.",
  },
];

export default function SellPage() {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-brand-900">
        <Photo
          src={IMAGE}
          alt=""
          sizes="100vw"
          className="absolute inset-0 -z-20 size-full opacity-60"
          fallbackClassName="from-brand-800 to-brand-900 [&>svg]:hidden"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-900 via-brand-900/85 to-brand-900/30" />
        <Container className="grid grid-cols-1 gap-12 py-20 lg:grid-cols-[1fr_440px] lg:py-28">
          <div className="text-white">
            <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-brass-400 uppercase">
              Sell with Adams
            </p>
            <h1 className="font-display-tight text-5xl leading-[1.05] font-normal sm:text-6xl">
              Sell for more, <em className="text-brass-100">with less stress.</em>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/75">
              Houses in town, lake homes, acreage, farms and commercial property across{" "}
              {site.market.region} — with one local point of contact from list to close. Start with
              a free, no-obligation valuation.
            </p>
          </div>
          <div id="valuation" className="scroll-mt-24 rounded-3xl bg-surface p-6 shadow-pop sm:p-8">
            <h2 className="text-xl font-semibold text-ink">What&apos;s my home worth?</h2>
            <p className="mt-1 mb-6 text-sm text-muted">
              Tell us about your home or land, and a local agent will prepare a personal valuation.
            </p>
            <ValuationForm />
          </div>
        </Container>
      </section>

      <Container className="py-20">
        <h2 className="max-w-xl font-display-tight text-4xl font-normal text-ink">
          How we sell homes
        </h2>
        <ol className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <s.icon className="size-5" />
                </span>
                <span className="text-sm font-semibold text-faint">0{i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </>
  );
}
