import { site } from "@/config/site";
import { GAMLS_SLUG } from "@/lib/mls/gamls";

/** The copyright line (IDX agreement §10): Georgia MLS holds the copyright in its listing content. */
export function mlsCopyright(year: number = new Date().getFullYear()): string {
  return `Listing information © ${year} ${site.mls.copyrightHolder}. All rights reserved.`;
}

/** The short copyright notice for cards, tiles and map popups: "© 2026 Georgia MLS". */
export function mlsCopyrightShort(year: number = new Date().getFullYear()): string {
  return `© ${year} ${site.mls.copyrightHolder}`;
}

function validDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const at = new Date(d);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** "Oct 26, 2026, 1:57 PM ET" in the market time zone (America/New_York). */
export function formatLastUpdated(at: Date): string {
  const when = at.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: site.market.timeZone,
  });
  // Newer ICU puts a narrow no-break space before AM/PM; plain-text emails want a plain one.
  return `${when.replace(/ /g, " ")} ET`;
}

/**
 * Georgia MLS's IDX disclaimer: "© 2026 Georgia MLS. All rights reserved. Information is deemed
 * reliable but is not guaranteed accurate by GAMLS. IDX information is provided exclusively for
 * consumers' personal, non-commercial use … interested in purchasing. Last updated Oct 26, 2026,
 * 1:57 PM ET". `lastUpdated` is the gamls source's last successful sync; without one, the build
 * time (BUILD_TIME, fixed in next.config.ts). With neither (a script outside Next), the
 * "Last updated" part is left out.
 */
export function mlsDisclaimer(
  lastUpdated: Date | string | null | undefined,
  now: Date = new Date(),
  buildTime: string | undefined = process.env.BUILD_TIME,
): string {
  const notice = `© ${now.getFullYear()} ${site.mls.copyrightHolder}. ${site.mls.disclaimer}. ${site.mls.consumerUseNotice}`;
  const at = validDate(lastUpdated) ?? validDate(buildTime);
  return at ? `${notice} Last updated ${formatLastUpdated(at)}` : notice;
}

/**
 * The disclaimer to show for a listing source: the computed Georgia MLS notice for the gamls
 * source (its stored `disclaimer` text is never shown), the stored text for any other.
 */
export function sourceDisclaimer(
  source: { slug: string; disclaimer: string | null; lastSyncedAt: Date | string | null },
  now: Date = new Date(),
): string | null {
  return source.slug === GAMLS_SLUG ? mlsDisclaimer(source.lastSyncedAt, now) : source.disclaimer;
}

/**
 * The disclaimers to show for the given sources (pass only sources with an active listing,
 * `sourcesWithPublicListings`): each through `sourceDisclaimer`, Georgia MLS's first,
 * empty ones dropped, duplicates shown once.
 */
export function sourceDisclaimers(
  sources: Parameters<typeof sourceDisclaimer>[0][],
  now: Date = new Date(),
): string[] {
  const gamlsFirst = [...sources].sort(
    (a, b) => Number(b.slug === GAMLS_SLUG) - Number(a.slug === GAMLS_SLUG),
  );
  const texts = gamlsFirst.flatMap((s) => sourceDisclaimer(s, now) || []);
  return [...new Set(texts)];
}
