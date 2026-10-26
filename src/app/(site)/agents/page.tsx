import { Languages, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { getAgents } from "@/lib/agents/queries";
import { demoDataMode } from "@/lib/demo-mode";

export const metadata: Metadata = {
  title: "Our agents",
  description: `Meet the real estate agents at ${site.legalName}, serving buyers and sellers across ${site.market.region}.`,
  alternates: { canonical: "/agents" },
};

export default async function AgentsPage() {
  const agents = await getAgents();
  // On the demo site the counts would be of sample listings: they wait for the real feed.
  const showCounts = !demoDataMode();
  return (
    <Container className="py-14">
      <div className="max-w-2xl">
        <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-500 uppercase">
          Our team
        </p>
        <h1 className="font-display-tight text-5xl font-normal text-ink">
          Local agents, not call centers.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          {site.name} agents help people buy and sell homes, land, farms and lake property across{" "}
          {site.market.region}. When you reach out, you talk to one of them.
        </p>
      </div>
      {/* Two across on phones, like the about page, so a team without photos yet isn't a column
          of full-width initials; the whole team in one row on desktop. */}
      <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-12 lg:grid-cols-5">
        {agents.map((a) => (
          <Link key={a.id} href={`/agents/${a.slug}`} className="group min-w-0">
            <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-sunken">
              <Avatar
                src={a.photoUrl}
                name={a.name}
                className="size-full text-4xl transition-transform duration-700 group-hover:scale-105 sm:text-5xl"
              />
            </div>
            <p className="mt-4 text-lg font-semibold text-ink group-hover:text-brand-700">
              {a.name}
            </p>
            <p className="text-sm text-muted">{a.title}</p>
            <div className="mt-3 space-y-1 text-xs text-ink-soft">
              {a.serviceAreas.length > 0 && (
                <p className="flex items-start gap-1.5">
                  <MapPin className="mt-px size-3.5 shrink-0 text-faint" />
                  <span className="line-clamp-2">{a.serviceAreas.join(", ")}</span>
                </p>
              )}
              {a.languages.length > 1 && (
                <p className="flex items-start gap-1.5">
                  <Languages className="mt-px size-3.5 shrink-0 text-faint" />
                  <span className="line-clamp-2">{a.languages.join(", ")}</span>
                </p>
              )}
              {showCounts && a.activeListings > 0 && (
                <p className="font-medium text-brand-700">{a.activeListings} active listings</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </Container>
  );
}
