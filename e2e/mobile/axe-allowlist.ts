/*
 * Pre-existing serious/critical axe findings that the mobile suites tolerate until their owner
 * fixes them. Lead-owned (docs/mobile-spec/foundation.md).
 *
 * Rules:
 * - color-contrast is never allowlisted (foundation exit criterion 4). expectNoSeriousAxe fails
 *   if an entry for it appears here.
 * - Every entry names the rule, a selector matching the offending element or one of its
 *   ancestors, the package that owns the file (see "Ownership after the foundation"), and a
 *   one-line reason. The owner deletes the entry in the same change that fixes the markup.
 */

export type AxeAllowEntry = {
  /** axe rule id. */
  rule: string;
  /** CSS selector; a finding is allowed when its element matches it or sits inside a match. */
  selector: string;
  /** Owning work package, e.g. "WP3". */
  owner: `WP${1 | 2 | 3 | 4 | 5 | 6}`;
  /** Where it is and why it is still here. */
  reason: string;
};

export const AXE_ALLOWLIST: readonly AxeAllowEntry[] = [
  {
    rule: "definition-list",
    selector: "main section dl:has(> a > dt)",
    owner: "WP2",
    reason:
      "Home hero stats (src/app/(site)/page.tsx) wrap each dt/dd pair in a Link inside the dl.",
  },
  {
    rule: "dlitem",
    selector: "main section dl:has(> a > dt)",
    owner: "WP2",
    reason: "Same home hero stats: the dt/dd sit inside an <a>, not directly in the dl or a div.",
  },
  {
    rule: "scrollable-region-focusable",
    selector: "article .snap-x.snap-mandatory",
    owner: "WP3",
    reason:
      "Listing-card photo track (listing-card.tsx) scrolls horizontally but is not focusable.",
  },
  {
    rule: "definition-list",
    selector: "main dl:has(> div > div > dt)",
    owner: "WP5",
    reason: "Listing page fact grid (homes/[slug]/page.tsx): BigFact nests dt/dd one div too deep.",
  },
  {
    rule: "dlitem",
    selector: "main dl:has(> div > div > dt)",
    owner: "WP5",
    reason: "Same listing fact grid: its dt/dd have a div parent that is not a direct child of dl.",
  },
  {
    rule: "target-size",
    selector: "main table tbody tr",
    owner: "WP6",
    reason:
      "Wide leads table (dashboard/leads/page.tsx): the stacked text-xs mailto/tel links and the row's stretched name link are under 24px apart. WP6's lead cards and sweep fix it.",
  },
  {
    rule: "aria-prohibited-attr",
    selector: ".maplibregl-marker",
    owner: "WP5",
    reason: "Listing location-map marker (location-map.tsx) sets aria-label on a div with no role.",
  },
];
