import { desc, eq } from "drizzle-orm";
import { Heart } from "lucide-react";
import type { Metadata } from "next";
import { SavedSearchRow } from "@/components/account/saved-search-row";
import { ListingCard } from "@/components/listings/listing-card";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/section";
import { db } from "@/db";
import { savedSearches } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { getSavedListings } from "@/lib/listings/queries";

export const metadata: Metadata = { title: "Saved homes", robots: { index: false } };

export default async function SavedPage() {
  const actor = await requireActor("/saved");
  const [homes, searches] = await Promise.all([
    getSavedListings(actor.userId),
    db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.userId, actor.userId))
      .orderBy(desc(savedSearches.createdAt)),
  ]);

  return (
    <Container className="py-12">
      <h1 className="font-display-tight text-4xl font-normal text-ink">Saved homes</h1>
      <p className="mt-2 text-muted">
        {homes.length
          ? `${homes.length} home${homes.length === 1 ? "" : "s"} — we'll email you if prices drop or status changes.`
          : "Tap the heart on any home to keep it here."}
      </p>

      {homes.length > 0 ? (
        <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {homes.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-line-strong px-6 py-16 text-center">
          <Heart className="size-10 text-faint" strokeWidth={1.5} />
          <p className="mt-4 font-semibold text-ink">No saved homes yet</p>
          <LinkButton href="/homes" className="mt-5">
            Start browsing
          </LinkButton>
        </div>
      )}

      <section className="mt-16">
        <h2 className="font-display-tight text-2xl font-medium text-ink">Saved searches</h2>
        <p className="mt-1 text-sm text-muted">
          Get an email when new homes match. Change or stop alerts any time.
        </p>
        {searches.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {searches.map((s) => (
              <SavedSearchRow key={s.id} search={s} />
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-2xl bg-sunken px-5 py-4 text-sm text-muted">
            Use <span className="font-medium text-ink">Save search</span> on the search page to get
            alerts for new listings.
          </p>
        )}
      </section>
    </Container>
  );
}
