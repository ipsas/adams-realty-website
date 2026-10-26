import { Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/listings/contact-form";
import { ListingCard } from "@/components/listings/listing-card";
import { AgentJsonLd } from "@/components/seo/json-ld";
import { Avatar } from "@/components/ui/avatar";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { bioExcerpt, bioParagraphs } from "@/lib/agents/bio";
import { getAgentBySlug } from "@/lib/agents/queries";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { demoDataMode } from "@/lib/demo-mode";
import { getAgentListings } from "@/lib/listings/queries";
import { OG_DEFAULT_IMAGE } from "@/lib/og";

/** One to three figures share the row; a lone one keeps a tile's width instead of the page's. */
const TILE_COLUMNS: Record<number, string> = {
  1: "grid-cols-1 sm:max-w-xs",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

/** Specialties, areas and languages share the row: as many columns as there are lists. */
const FACT_COLUMNS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
};

export async function generateMetadata(props: PageProps<"/agents/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getAgentBySlug(slug);
  if (!data) return { title: "Agent not found" };
  const { name, title, bio } = data.agent;
  return {
    title: `${name}, ${title ?? "Agent"}`,
    // An agent without a bio yet gets a plain line of fact, not invented copy.
    description:
      bioExcerpt(bio) ??
      `${name}, ${title ?? "agent"} at ${site.legalName} in ${site.address.city}, Georgia.`,
    alternates: { canonical: `/agents/${slug}` },
    openGraph: { images: data.agent.photoUrl ? [{ url: data.agent.photoUrl }] : [OG_DEFAULT_IMAGE] },
  };
}

export default async function AgentPage(props: PageProps<"/agents/[slug]">) {
  const data = await getAgentBySlug((await props.params).slug);
  if (!data) notFound();
  const { agent: a, stats } = data;
  // On the demo site every listing is a sample, so sales (a count, or "Sold" cards) would be an
  // invented record for a real person: they wait for the real feed.
  const demo = demoDataMode();
  const [listings, session] = await Promise.all([
    getAgentListings(a.id, { includeClosed: !demo }),
    getSession(),
  ]);
  // Only figures we actually have: years in the business is left off until the agent supplies it.
  // Listing counts wait for the real feed too: on the demo site they'd count sample listings.
  const tiles: [string, number][] = demo
    ? []
    : [
        ["Active listings", stats.active],
        ["Recent sales", stats.sold],
      ];
  if (a.yearsExperience !== null) tiles.unshift(["Years in real estate", a.yearsExperience]);
  // Everything below is optional: a profile shows only what the agent has supplied.
  const bio = bioParagraphs(a.bio);
  const facts = (
    [
      ["Specialties", a.specialties],
      ["Areas served", a.serviceAreas],
      ["Languages", a.languages],
    ] as const
  ).filter(([, items]) => items.length > 0);

  return (
    <Container className="py-12">
      <AgentJsonLd agent={a} />
      {/* Phones: profile, contact form, listings. Desktop: the listings fill the column under the
          profile, beside the sticky form, so a short profile leaves no gap next to it. */}
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-end">
            <Avatar
              src={a.photoUrl}
              name={a.name}
              className="size-40 shrink-0 rounded-[var(--radius-card)] text-5xl"
            />
            <div>
              <p className="text-sm font-semibold tracking-wide text-brass-500 uppercase">
                {a.title}
              </p>
              <h1 className="mt-1 font-display-tight text-5xl font-normal text-ink">{a.name}</h1>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
                {a.phone && (
                  <a
                    href={`tel:${a.phone.replace(/\D/g, "")}`}
                    className="flex flex-wrap items-center gap-x-2 hover:text-ink"
                  >
                    <Phone className="size-4 text-faint" /> {a.phone}
                    {/* Agents without a direct line take calls at the office. */}
                    {a.phone === site.phone && <span className="text-faint">· Office</span>}
                  </a>
                )}
                {/* flex-wrap: on a narrow phone "· Office" moves under the address. */}
                <a
                  href={`mailto:${a.email}`}
                  className="flex flex-wrap items-center gap-x-2 hover:text-ink"
                >
                  <Mail className="size-4 text-faint" /> {a.email}
                  {/* The firm's shared inbox, for agents without an address of their own. */}
                  {a.email === site.email && <span className="text-faint">· Office</span>}
                </a>
              </div>
            </div>
          </div>

          {tiles.length > 0 && (
            <dl
              className={cn(
                "mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line",
                TILE_COLUMNS[tiles.length],
              )}
            >
              {tiles.map(([label, value]) => (
                <div key={label} className="bg-surface px-5 py-4">
                  <dd className="text-2xl font-semibold text-ink tabular">{value}</dd>
                  <dt className="text-xs text-muted">{label}</dt>
                </div>
              ))}
            </dl>
          )}

          {bio.length > 0 && (
            <div
              className="mt-10 max-w-2xl space-y-5 text-lg leading-relaxed text-ink-soft"
              data-testid="agent-bio"
            >
              {bio.map((p, i) => (
                <p key={i} className="whitespace-pre-line">
                  {p}
                </p>
              ))}
            </div>
          )}

          {facts.length > 0 && (
            <div className={cn("mt-8 grid grid-cols-1 gap-6", FACT_COLUMNS[facts.length])}>
              {facts.map(([label, items]) => (
                <div key={label}>
                  <h2 className="text-xs font-semibold tracking-widest text-faint uppercase">
                    {label}
                  </h2>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {items.map((i) => (
                      <li
                        key={i}
                        className="rounded-full bg-sunken px-3 py-1 text-sm text-ink-soft"
                      >
                        {i}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {a.licenseNumber && (
            <p className="mt-8 text-xs text-faint">
              License {a.licenseNumber} · {site.legalName}
            </p>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="rounded-3xl border border-line bg-surface p-6 shadow-card">
            <p className="mb-5 font-display-tight text-2xl text-ink">
              Contact {a.name.split(" ")[0]}
            </p>
            <ContactForm
              agentId={a.id}
              source="agent"
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
        </aside>

        {listings.length > 0 && (
          <section className="min-w-0 lg:col-start-1">
            <h2 className="mb-6 font-display-tight text-3xl font-medium text-ink">
              {a.name.split(" ")[0]}&apos;s listings
            </h2>
            <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
              {listings.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  sizes="(min-width: 1024px) 245px, (min-width: 640px) 45vw, 92vw"
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </Container>
  );
}
