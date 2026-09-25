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
    "Homes, land, farms, lake and commercial property for sale across Northeast Georgia, with Adams Realty, Inc. Listings from Georgia MLS, honest monthly costs, and no ads.",
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
  mls: { name: "Georgia MLS", officeId: "ADAM01" },
  /** Default map view and the phrases used in copy ("Homes for sale in Northeast Georgia"). */
  market: {
    name: "Northeast Georgia",
    region: "Northeast Georgia",
    state: "GA",
    stateName: "Georgia",
    timeZone: "America/New_York",
    /** Counties the firm serves, in the order copy lists them. */
    counties: ["Franklin", "Hart", "Madison", "Stephens", "Jackson", "Hall", "Gwinnett"],
    // Near Commerce: the whole service area, from Gwinnett to Lake Hartwell, fits at this zoom.
    center: { lng: -83.45, lat: 34.22 },
    zoom: 8.3,
  },
  /** Defaults for the payment calculator. */
  finance: {
    interestRate: 6.25,
    downPaymentPct: 20,
    loanTermYears: 30,
    /** Annual homeowners insurance as a % of price. */
    insuranceRatePct: 0.6,
    /**
     * Fallback property-tax rate when a listing has no tax figure: a rough
     * middle for the rural and small-town counties the firm serves. Listings
     * from the MLS usually carry the actual tax amount, which is used instead.
     */
    propertyTaxRatePct: 0.9,
  },
  social: {
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/",
    linkedin: "https://linkedin.com/",
  },
  /** Extra consumer-notice links for the footer (some states require them; Georgia doesn't). */
  legalLinks: [] as { label: string; href: string }[],
  /**
   * Towns linked from the homepage hero and footer. Each must match seeded or
   * MLS listings' city or neighborhood so the search link finds homes.
   */
  featuredAreas: ["Royston", "Lavonia", "Hartwell", "Commerce", "Toccoa"],
} as const;

/** The service area as a phrase for copy: "Franklin, Hart, … Hall and Gwinnett counties". */
export const serviceCounties = `${site.market.counties.slice(0, -1).join(", ")} and ${site.market.counties.at(-1)} counties`;

export const nav = [
  { label: "Buy", href: "/homes" },
  { label: "Rent", href: "/homes?mode=rent" },
  { label: "Sell", href: "/sell" },
  { label: "Agents", href: "/agents" },
] as const;
