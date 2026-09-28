import { site } from "@/config/site";
import { cn } from "@/lib/cn";

/**
 * Georgia MLS's name and logo (IDX agreement §7). The official logo files when
 * `site.mls.logo` is set, the standard one in light mode and the "reverse" one
 * in dark; until then the name as a text wordmark in the theme's ink color, so
 * it reads in both themes.
 */
export function MlsMark({ className }: { className?: string }) {
  const logo = site.mls.logo;
  if (logo) {
    return (
      <span className={cn("inline-flex shrink-0", className)} data-mls-mark="logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
        <img
          src={logo.light}
          alt={site.mls.name}
          width={logo.width}
          height={logo.height}
          className="h-8 w-auto dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
        <img
          src={logo.dark}
          alt={site.mls.name}
          width={logo.width}
          height={logo.height}
          className="hidden h-8 w-auto dark:block"
        />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border border-line-strong px-2 py-1 text-sm font-bold tracking-tight text-ink",
        className,
      )}
      data-mls-mark="text"
    >
      {site.mls.name}
    </span>
  );
}

/** The copyright line (IDX agreement §10): Georgia MLS holds the copyright in its listing content. */
export function mlsCopyright(year: number = new Date().getFullYear()): string {
  return `Listing information © ${year} ${site.mls.copyrightHolder}. All rights reserved.`;
}

/**
 * Source attribution for pages that show Georgia MLS listing data: the name
 * and logo, and the copyright notice. The footer carries it on every site
 * page; the search page and listing pages carry it in their own content.
 */
export function MlsAttribution({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)} data-mls-attribution>
      <MlsMark />
      <p>
        Listings courtesy of {site.mls.name}. {mlsCopyright()} Each listing names its listing firm.
      </p>
    </div>
  );
}
