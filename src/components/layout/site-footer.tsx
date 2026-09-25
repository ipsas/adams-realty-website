import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { addressLines, telHref } from "@/components/content/contact";
import { EqualHousingLogo } from "@/components/content/equal-housing-logo";
import { site } from "@/config/site";
import { cn } from "@/lib/cn";
import { Logo } from "./logo";

type FooterLink = { label: string; href: string; emphasis?: boolean };

const contactLink = "inline-flex min-h-10 items-center hover:text-ink sm:min-h-0";

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Find a home",
    links: [
      { label: "Homes for sale", href: "/homes" },
      { label: "Homes for rent", href: "/homes?mode=rent" },
      { label: "Open houses", href: "/homes?openHouse=1" },
      { label: "New construction", href: "/homes?newConstruction=1" },
      { label: "Recently sold", href: "/homes?mode=sold" },
    ],
  },
  {
    title: "Work with us",
    links: [
      { label: "Sell your home", href: "/sell" },
      { label: "What's my home worth?", href: "/sell#valuation" },
      { label: "Our agents", href: "/agents" },
      { label: "Our listings", href: "/homes?ourListings=1" },
    ],
  },
  {
    title: "Neighborhoods",
    links: [
      ...site.featuredAreas.map((a) => ({ label: a, href: `/homes?q=${encodeURIComponent(a)}` })),
      { label: "Neighborhood guides", href: "/areas", emphasis: true },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Fair housing", href: "/fair-housing" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms of use", href: "/terms" },
      { label: "Accessibility", href: "/accessibility" },
    ],
  },
];

/**
 * Label with a trailing arrow glued to its last word, so when the label wraps
 * in a narrow column the arrow follows the text instead of pinning to the
 * column's edge or dropping onto a line of its own.
 */
function ArrowLabel({ label }: { label: string }) {
  const split = label.lastIndexOf(" ") + 1;
  return (
    <span>
      {label.slice(0, split)}
      <span className="whitespace-nowrap">
        {label.slice(split)}
        <ArrowRight aria-hidden className="ml-1.5 inline size-3.5 align-[-0.125em]" />
      </span>
    </span>
  );
}

export function SiteFooter({ disclaimer }: { disclaimer?: string | null }) {
  return (
    <footer className="mt-24 border-t border-line bg-sunken/60">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 lg:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))] lg:gap-x-10">
          <div className="col-span-2 max-w-sm sm:col-span-4 lg:col-span-1 lg:pr-4">
            <Logo className="min-h-10 w-fit sm:min-h-0" />
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Independent and local. No ads, no selling your information — just great agents and
              every home on the market.
            </p>
            {/* Each line is 40px tall on phones (tap targets, even rhythm); plain text lines from sm up. */}
            <div className="mt-3.5 text-sm text-ink-soft sm:mt-6">
              <p className="py-2.5 sm:mb-1 sm:py-0">{addressLines(site.address).join(", ")}</p>
              <p>
                <a href={telHref(site.phone)} className={contactLink}>
                  {site.phone}
                </a>
              </p>
              <p className="sm:mt-1">
                <a
                  href={`mailto:${site.email}`}
                  className={cn(contactLink, "[overflow-wrap:anywhere]")}
                >
                  {site.email}
                </a>
              </p>
            </div>
          </div>
          {columns.map((col) => (
            <div key={col.title} className="min-w-0">
              <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
                {col.title}
              </h2>
              <ul className="mt-3 sm:mt-4 sm:space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className={cn(
                        "flex min-h-10 items-center text-sm transition-colors sm:min-h-0",
                        l.emphasis
                          ? "font-medium text-brand-700 hover:text-brand-800"
                          : "text-ink-soft hover:text-ink",
                      )}
                    >
                      {l.emphasis ? <ArrowLabel label={l.label} /> : l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 space-y-4 border-t border-line pt-8 text-xs leading-relaxed text-muted">
          {disclaimer && <p>{disclaimer}</p>}
          <p className="flex items-start gap-2">
            <EqualHousingLogo className="mt-0.5 size-5 shrink-0 text-ink-soft" />
            <span>
              {site.legalName} is licensed by the Georgia Real Estate Commission and is committed to
              the Fair Housing Act and the Equal Opportunity Act. We do not discriminate on the
              basis of race, color, religion, sex, handicap, familial status, national origin, or
              any other protected class.
            </span>
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {site.legalLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:text-ink hover:underline"
              >
                {l.label}
              </a>
            ))}
            {site.brokerLicense && <span>GREC firm license {site.brokerLicense}</span>}
            <span>
              © {new Date().getFullYear()} {site.legalName}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
