import { Languages, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { getAgents } from "@/lib/agents/queries";

export const metadata: Metadata = {
  title: "Our agents",
  description: `Meet the real estate agents at ${site.legalName} in ${site.address.city}, serving buyers and sellers across ${site.market.region}.`,
};

export default async function AgentsPage() {
  const agents = await getAgents();
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
          {site.market.region}. When you reach out, you talk to one of them — directly.
        </p>
      </div>
      <div className="mt-12 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
        {agents.map((a) => (
          <Link key={a.id} href={`/agents/${a.slug}`} className="group">
            <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-sunken">
              <Avatar
                src={a.photoUrl}
                name={a.name}
                className="size-full text-5xl transition-transform duration-700 group-hover:scale-105"
              />
            </div>
            <p className="mt-4 text-lg font-semibold text-ink group-hover:text-brand-700">
              {a.name}
            </p>
            <p className="text-sm text-muted">{a.title}</p>
            <div className="mt-3 space-y-1 text-xs text-ink-soft">
              {a.serviceAreas.length > 0 && (
                <p className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-faint" /> {a.serviceAreas.join(", ")}
                </p>
              )}
              {a.languages.length > 1 && (
                <p className="flex items-center gap-1.5">
                  <Languages className="size-3.5 text-faint" /> {a.languages.join(", ")}
                </p>
              )}
              {a.activeListings > 0 && (
                <p className="font-medium text-brand-700">{a.activeListings} active listings</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </Container>
  );
}
