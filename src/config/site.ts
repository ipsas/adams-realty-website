/**
 * Brand and market settings. Everything company-specific that isn't data
 * lives here, so rebranding or moving markets is a one-file change.
 *
 * The firm name, office address, office phone, broker and MLS IDs below are the
 * company's real, published details; the office hours, GREC firm license and
 * DMCA designated agent were provided by Adams Realty on 2026-10-02. Anything
 * not set here is unknown: never invent it. Georgia Real Estate Commission
 * rules require the firm name and firm phone number on advertising, and the
 * footer renders both on every page.
 */
export const site = {
  name: "Adams Realty",
  legalName: "Adams Realty, Inc.",
  tagline: "Homes worth coming home to.",
  description:
    "Homes, land, farms and lake property around Gainesville, straight from Georgia MLS, with the true cost of owning each home and no ads.",
  phone: "(706) 246-0053",
  /** The firm's public inbox (Andrea's). Also the fallback address for leads when LEADS_INBOX is unset. */
  email: "contracts.adamsrealty@gmail.com",
  address: {
    line1: "69 Mill Street",
    city: "Royston",
    state: "GA",
    postalCode: "30662",
  },
  /**
   * Office hours, as provided by Adams Realty on 2026-10-02 ("Monday–Friday,
   * 9 a.m.–5 p.m."). Null would hide them everywhere.
   */
  hours: "Mon–Fri, 9 a.m.–5 p.m." as string | null,
  /** GREC firm license number, provided by Adams Realty on 2026-10-02. Null would hide it. */
  brokerLicense: "6079" as string | null,
  /**
   * The firm's DMCA designated agent (IDX agreement §11), as registered with the
   * U.S. Copyright Office and provided by Adams Realty on 2026-10-02. Published
   * on /terms#copyright; the agent's mailing address is the office (`address`).
   */
  dmca: {
    agent: "Andrea A. Anderegg",
    /** U.S. Copyright Office DMCA Designated Agent Directory registration. */
    registration: "DMCA-1081724",
    /** When the designation took effect (YYYY-MM-DD). */
    effective: "2026-10-02",
    phone: "(850) 572-3287",
    email: "contracts.adamsrealty@gmail.com",
  },
  /** The firm's broker. Their agent profile (bio, photo, contact) lives in the database. */
  broker: { name: "Andrea Anderegg" },
  /**
   * The MLS the firm belongs to. Its IDX feed supplies the other brokerages'
   * listings, and `officeId` marks the firm's own listings in that feed.
   */
  mls: {
    name: "Georgia MLS",
    officeId: "ADAM01",
    /**
     * IDX agreement §10: the copyright notice names Georgia MLS as the holder
     * of the listing content (the agreement's own name for it).
     */
    copyrightHolder: "Georgia MLS",
    /**
     * IDX agreement §7: the Georgia MLS name and logo on pages with its
     * listings. The official GAMLS IDX logo supplied by Georgia MLS (blue and
     * gold on transparent, 300 × 118 PNG); one image for both themes, drawn on
     * a white chip in dark mode. `MlsMark` draws it 32 px tall (81 px wide).
     * Null would show the name as a text wordmark instead.
     */
    logo: { src: "/brand/gamls_idx.png", width: 300, height: 118 } as {
      src: string;
      width: number;
      height: number;
    } | null,
    /**
     * The smallest logo file Georgia MLS supplied (81 × 32 PNG), drawn at its
     * native 32 px height on cards, tiles and map popups: the logo is never
     * shown smaller than this. Falls back to `logo` when null.
     */
    logoSmall: { src: "/brand/gamls_idx_81x32.png", width: 81, height: 32 } as {
      src: string;
      width: number;
      height: number;
    } | null,
    /**
     * IDX agreement Exhibit A §6: how Georgia MLS (or anyone) reports a listing
     * with wrong information. Published on /listing-corrections and linked from
     * every listing page; fixes or removals happen within one business day.
     */
    corrections: { email: "contracts.adamsrealty@gmail.com", phone: "(706) 246-0053" },
    /**
     * The fixed wording of the copyright notice: IDX Agreement Exhibit A §10
     * ("information is deemed reliable but is not guaranteed") and R&R Art.
     * III-2 §12 f ("…deemed reliable but is not guaranteed accurate by GAMLS").
     * `mlsDisclaimer` (src/lib/mls-copyright.ts) adds the current year and the
     * last-updated time.
     */
    disclaimer:
      "All rights reserved. Information is deemed reliable but is not guaranteed accurate by GAMLS",
    /**
     * R&R Art. III-2 §12 f: the consumers' personal, non-commercial use notice,
     * shown in `mlsDisclaimer` after the copyright notice.
     */
    consumerUseNotice:
      "IDX information is provided exclusively for consumers' personal, non-commercial use and may not be used for any purpose other than to identify prospective properties consumers may be interested in purchasing.",
  },
  /**
   * What the listings cover: Georgia MLS IDX, statewide. Search headings, the
   * search map's first view and SEO copy about listings use this. Bounds are
   * the state's extent (Census TIGERweb).
   */
  coverage: {
    name: "Georgia",
    bounds: { west: -85.61, south: 30.35, east: -80.75, north: 35.01 },
  },
  /**
   * The firm: where Adams Realty works. Copy about the firm (who we are, where
   * our agents tour homes) uses this, never `coverage`.
   */
  market: {
    region: "Northeast Georgia",
    state: "GA",
    stateName: "Georgia",
    timeZone: "America/New_York",
    /** The place the firm's SEO copy leads with (market-copy-draft, 2026-10-23): one place per element, never a town list. */
    focus: { city: "Gainesville", lake: "Lake Lanier" },
    /**
     * Counties the firm serves, in the order copy lists them. A listing in one
     * of these (or in an area guide's county) is in the firm's area: see
     * src/lib/areas/firm-area.ts.
     */
    counties: ["Hall", "Gwinnett", "Jackson", "Franklin", "Hart", "Madison", "Stephens"],
    /**
     * The seven counties' combined extent (Census TIGERweb, rounded outward).
     * Saved searches with no location made while the site was regional were
     * pinned to it at the statewide cutover (drizzle/0009).
     */
    bounds: { west: -84.28, south: 33.75, east: -82.77, north: 34.69 },
  },
  /** Defaults for the payment calculator. */
  finance: {
    interestRate: 6.25,
    downPaymentPct: 20,
    loanTermYears: 30,
    /** Annual homeowners insurance as a % of price (inland Georgia). */
    insuranceRatePct: 0.6,
    /**
     * Fallback property-tax rate when a listing has no tax figure: a rough
     * middle for Georgia's small-town and rural counties, the firm's included.
     * Listings from the MLS usually carry the actual tax amount, which is used
     * instead.
     */
    propertyTaxRatePct: 0.9,
    /**
     * Regional overrides of the two rates above, by county (`financeFor` in
     * src/lib/mortgage.ts). Rough statewide patterns, not quotes: coastal
     * homes pay more for wind and storm cover (flood insurance is extra and
     * not included), and the big metro and city-county governments levy more
     * than rural counties. A county in several lists takes each list's rate.
     */
    regions: [
      {
        name: "Coastal Georgia",
        counties: ["Chatham", "Glynn", "Camden", "Liberty", "Bryan", "McIntosh"],
        insuranceRatePct: 1.2,
      },
      {
        name: "Metro and city-county property tax",
        counties: [
          "Fulton",
          "DeKalb",
          "Clayton",
          "Cobb",
          "Henry",
          "Douglas",
          "Rockdale",
          "Richmond",
          "Bibb",
          "Muscogee",
          "Chatham",
          "Clarke",
          "Dougherty",
        ],
        propertyTaxRatePct: 1.1,
      },
    ] as {
      name: string;
      counties: string[];
      insuranceRatePct?: number;
      propertyTaxRatePct?: number;
    }[],
  },
  social: {
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/",
    linkedin: "https://linkedin.com/",
  },
  /** Extra consumer-notice links for the footer (some states require them; Georgia doesn't). */
  legalLinks: [] as { label: string; href: string }[],
} as const;

/** The service area as a phrase for copy: "Franklin, Hart, … Hall and Gwinnett counties". */
export const serviceCounties = `${site.market.counties.slice(0, -1).join(", ")} and ${site.market.counties.at(-1)} counties`;

export const nav = [
  { label: "Buy", href: "/homes" },
  { label: "Rent", href: "/homes?mode=rent" },
  { label: "Sell", href: "/sell" },
  { label: "Area guides", href: "/areas" },
  { label: "Agents", href: "/agents" },
] as const;
