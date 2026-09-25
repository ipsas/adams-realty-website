import Link from "next/link";
import { site } from "@/config/site";
import { Logo } from "./logo";

const columns = [
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
    links: site.featuredAreas.map((a) => ({ label: a, href: `/homes?q=${encodeURIComponent(a)}` })),
  },
];

export function SiteFooter({ disclaimer }: { disclaimer?: string | null }) {
  return (
    <footer className="mt-24 border-t border-line bg-sunken/60">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Independent and local. No ads, no selling your information — just great agents and
              every home on the market.
            </p>
            <div className="mt-6 space-y-1 text-sm text-ink-soft">
              <p>
                {[
                  site.address.line1,
                  site.address.city,
                  `${site.address.state} ${site.address.postalCode}`.trim(),
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p>
                <a href={`tel:${site.phone.replace(/\D/g, "")}`} className="hover:text-ink">
                  {site.phone}
                </a>{" "}
                ·{" "}
                <a href={`mailto:${site.email}`} className="hover:text-ink">
                  {site.email}
                </a>
              </p>
            </div>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h2 className="text-xs font-semibold tracking-widest text-faint uppercase">
                {col.title}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-ink-soft transition-colors hover:text-ink"
                    >
                      {l.label}
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
            <EqualHousingIcon />
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

function EqualHousingIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-0.5 size-5 shrink-0 text-ink-soft"
      aria-label="Equal Housing Opportunity"
      role="img"
    >
      <path d="M12 3 2 10h2v10h16V10h2L12 3Zm6 15H6v-8.6L12 5.4l6 4V18Z" fill="currentColor" />
      <path d="M8 11h8v2H8zm0 3h8v2H8z" fill="currentColor" />
    </svg>
  );
}
