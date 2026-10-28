import { site } from "@/config/site";
import { cn } from "@/lib/cn";
import { MlsCopyright, MlsCopyrightShort } from "./copyright-year";

export { mlsCopyright, mlsCopyrightShort } from "@/lib/mls-copyright";

/**
 * Georgia MLS's name and logo (IDX agreement §7). The official GAMLS IDX logo
 * when `site.mls.logo` is set: one image for both themes, on a white chip in
 * dark mode so the blue and gold read; 24 px tall in both sizes (`sm`, cards
 * and popups, uses the 81 × 32 `logoSmall` file). GAMLS sets no minimum logo
 * size; 24 px is the business's chosen middle ground between 20 px and the
 * original 32 px ("GAMLS" about 14 px tall, the gold "IDX" box about 7 px,
 * scaled from the 300 × 118 source). IDX agreement §18 presumes co-branding is
 * not misleading when the participant's logo is larger than any third party's;
 * the Adams logo (161 × 32) stays larger. When
 * `site.mls.logo` is null, the name as a text wordmark in the theme's ink
 * color, so it reads in both themes.
 */
export function MlsMark({ className, size = "md" }: { className?: string; size?: "md" | "sm" }) {
  const logo = size === "sm" ? (site.mls.logoSmall ?? site.mls.logo) : site.mls.logo;
  if (logo) {
    const srcSet = mlsLogoSrcSet(logo);
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-md dark:bg-white",
          size === "md" ? "dark:px-1.5 dark:py-1" : "dark:px-1 dark:py-0.5",
          className,
        )}
        data-mls-mark="logo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static PNG */}
        <img
          src={logo.src}
          srcSet={srcSet}
          alt={site.mls.name}
          width={logo.width}
          height={logo.height}
          className="h-6 w-auto"
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

/**
 * High-DPI screens get the 300 × 118 file for the 81 × 32 one (the map popup builds its
 * logo by hand and uses this too). Undefined for the large file or when either is unset.
 */
export function mlsLogoSrcSet(logo: { src: string }): string | undefined {
  const { logo: large, logoSmall: small } = site.mls;
  if (!large || !small || logo.src !== small.src) return undefined;
  return `${small.src} 1x, ${large.src} 2x`;
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
        Listings courtesy of {site.mls.name}. <MlsCopyright /> Each listing names its listing firm.
      </p>
    </div>
  );
}

/**
 * The compact credit for cards, tiles and popups of Georgia MLS listings: the
 * name (the logo's alt text and the notice), the logo at 24 px, and the
 * copyright holder.
 */
export function MlsCredit({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5", className)} data-mls-credit>
      <MlsMark size="sm" />
      <span className="truncate">
        <MlsCopyrightShort />
      </span>
    </span>
  );
}
