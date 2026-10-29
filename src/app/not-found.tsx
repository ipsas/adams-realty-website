import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { areaHref } from "@/config/areas";
import { guideBySlug, MISSING_LISTING_GUIDE_HEADER } from "@/lib/listings/missing-listing";

export const metadata: Metadata = {
  title: { absolute: "Page not found | Adams Realty" },
  robots: { index: false },
};

export default async function NotFound() {
  // Set by src/proxy.ts for a missing listing; only an existing guide's slug counts.
  const guide = guideBySlug((await headers()).get(MISSING_LISTING_GUIDE_HEADER));
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      {guide && (
        <Link href={areaHref(guide)} className="mb-6 font-medium text-brand-700 hover:underline">
          See homes for sale in {guide.name}, GA
        </Link>
      )}
      <p className="text-sm font-semibold tracking-widest text-brass-500 uppercase">404</p>
      <h1 className="mt-3 font-display-tight text-4xl text-ink">We couldn&apos;t find that page</h1>
      <p className="mt-3 max-w-md text-muted">
        The home may have sold or the link may be out of date. Plenty more where it came from,
        though.
      </p>
      <div className="mt-8 flex gap-3">
        <LinkButton href="/homes">Search homes</LinkButton>
        <LinkButton href="/" variant="secondary">
          Home
        </LinkButton>
      </div>
    </main>
  );
}
