/**
 * Brand and market settings. Everything company-specific that isn't data
 * lives here, so rebranding or moving markets is a one-file change.
 *
 * The firm name, office address, office phone, broker and MLS IDs below are the
 * company's real, published details. Values marked PLACEHOLDER are not known
 * yet and must come from Adams Realty before launch. Georgia Real Estate
 * Commission rules require the firm name and firm phone number on advertising,
 * and the footer renders both on every page.
 */
export const site = {
  name: "Adams Realty",
  legalName: "Adams Realty, Inc.",
  tagline: "Homes worth coming home to.",
  description:
    "Homes, land, farms, lake and commercial property for sale across Georgia, with Adams Realty, Inc. in Royston. Listings from Georgia MLS, the true cost of owning each home, and no ads.",
  phone: "(706) 246-0053",
  /** The firm's public inbox (Andrea's). Also the fallback address for leads when LEADS_INBOX is unset. */
  email: "contracts.adamsrealty@gmail.com",
  address: {
    line1: "69 Mill Street",
    city: "Royston",
    state: "GA",
    postalCode: "30662",
  },
  /** PLACEHOLDER — office hours, e.g. "Mon–Fri 9am–5pm". Hidden everywhere while null. */
  hours: null as string | null,
  /** PLACEHOLDER — GREC firm license number, e.g. "H-12345". Hidden while null. */
  brokerLicense: null as string | null,
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
     * listings. Null shows the name as a text wordmark. The official files are
     * at gamls.com/logos (standard, and "reverse" for dark backgrounds): save
     * them under public/brand/ and set, e.g.,
     * `{ light: "/brand/gamls-logo.svg", dark: "/brand/gamls-logo-reverse.svg", width: 150, height: 47 }`.
     */
    logo: null as { light: string; dark: string; width: number; height: number } | null,
    /**
     * IDX agreement Exhibit A §6: how Georgia MLS (or anyone) reports a listing
     * with wrong information. Published on /listing-corrections and linked from
     * every listing page; fixes or removals happen within one business day.
     */
    corrections: { email: "contracts.adamsrealty@gmail.com", phone: "(706) 246-0053" },
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
    /**
     * Counties the firm serves, in the order copy lists them. A listing in one
     * of these (or in an area guide's county) is in the firm's area: see
     * src/lib/areas/firm-area.ts.
     */
    counties: ["Franklin", "Hart", "Madison", "Stephens", "Jackson", "Hall", "Gwinnett"],
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
  { label: "Agents", href: "/agents" },
] as const;
