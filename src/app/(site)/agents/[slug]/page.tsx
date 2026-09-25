import { Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/listings/contact-form";
import { ListingCard } from "@/components/listings/listing-card";
import { Avatar } from "@/components/ui/avatar";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { getAgentBySlug } from "@/lib/agents/queries";
import { getSession } from "@/lib/auth/session";
import { getAgentListings } from "@/lib/listings/queries";

export async function generateMetadata(props: PageProps<"/agents/[slug]">): Promise<Metadata> {
  const data = await getAgentBySlug((await props.params).slug);
  if (!data) return { title: "Agent not found" };
  return {
    title: `${data.agent.name}, ${data.agent.title ?? "Agent"}`,
    description: data.agent.bio?.slice(0, 160),
    openGraph: { images: data.agent.photoUrl ? [{ url: data.agent.photoUrl }] : undefined },
  };
}

export default async function AgentPage(props: PageProps<"/agents/[slug]">) {
  const data = await getAgentBySlug((await props.params).slug);
  if (!data) notFound();
  const { agent: a, stats } = data;
  const [listings, session] = await Promise.all([getAgentListings(a.id), getSession()]);

  return (
    <Container className="py-12">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div>
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
                    className="flex items-center gap-2 hover:text-ink"
                  >
                    <Phone className="size-4 text-faint" /> {a.phone}
                  </a>
                )}
                <a href={`mailto:${a.email}`} className="flex items-center gap-2 hover:text-ink">
                  <Mail className="size-4 text-faint" /> {a.email}
                </a>
              </div>
            </div>
          </div>

          <dl className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {[
              ["Years in real estate", a.yearsExperience ?? "—"],
              ["Active listings", stats.active],
              ["Recent sales", stats.sold],
            ].map(([label, value]) => (
              <div key={label} className="bg-surface px-5 py-4">
                <dd className="text-2xl font-semibold text-ink tabular">{value}</dd>
                <dt className="text-xs text-muted">{label}</dt>
              </div>
            ))}
          </dl>

          {a.bio && (
            <p className="mt-10 max-w-2xl text-lg leading-relaxed whitespace-pre-line text-ink-soft">{a.bio}</p>
          )}

          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              ["Specialties", a.specialties],
              ["Neighborhoods", a.serviceAreas],
              ["Languages", a.languages],
            ].map(([label, items]) =>
              (items as string[]).length ? (
                <div key={label as string}>
                  <h2 className="text-xs font-semibold tracking-widest text-faint uppercase">
                    {label as string}
                  </h2>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {(items as string[]).map((i) => (
                      <li
                        key={i}
                        className="rounded-full bg-sunken px-3 py-1 text-sm text-ink-soft"
                      >
                        {i}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
          {a.licenseNumber && (
            <p className="mt-8 text-xs text-faint">
              License {a.licenseNumber} · {site.legalName}
            </p>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
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
      </div>

      {listings.length > 0 && (
        <section className="mt-20">
          <h2 className="mb-6 font-display-tight text-3xl font-medium text-ink">
            {a.name.split(" ")[0]}&apos;s listings
          </h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}
