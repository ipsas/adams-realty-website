/**
 * Brand and market settings. Everything company-specific that isn't data
 * lives here, so rebranding or moving markets is a one-file change.
 *
 * TODO(adams): values marked PLACEHOLDER must be replaced with the firm's real
 * details before launch. Georgia Real Estate Commission rules require the firm
 * name and firm phone number on advertising, and the footer renders both on
 * every page.
 */
export const site = {
  name: "Adams Realty",
  legalName: "Adams Realty, Inc.",
  tagline: "Homes worth coming home to.",
  description:
    "Search every home for sale in Metro Atlanta and across Georgia with the local agents at Adams Realty. Real-time listings, honest monthly costs, and no ads — ever.",
  /** PLACEHOLDER — the firm's main phone number. */
  phone: "(404) 555-0142",
  /** PLACEHOLDER — the firm's public inbox. */
  email: "hello@adamsrealty.example",
  /** PLACEHOLDER — leave `line1` empty to show only city and state. */
  address: {
    line1: "",
    city: "Atlanta",
    state: "GA",
    postalCode: "",
  },
  hours: "Mon–Sat 9am–6pm",
  /** PLACEHOLDER — GREC firm license number, e.g. "H-12345". Hidden while null. */
  brokerLicense: null as string | null,
  /** Default map view and the phrase used in copy ("homes in Atlanta"). */
  market: {
    name: "Atlanta",
    region: "Metro Atlanta",
    state: "GA",
    stateName: "Georgia",
    timeZone: "America/New_York",
    center: { lng: -84.388, lat: 33.849 },
    zoom: 9.4,
  },
  /** Defaults for the payment calculator. */
  finance: {
    interestRate: 6.25,
    downPaymentPct: 20,
    loanTermYears: 30,
    /** Annual homeowners insurance as a % of price. */
    insuranceRatePct: 0.6,
    /** Fallback property-tax rate when a listing has no tax figure (Georgia effective rates run ~0.8–1.1%). */
    propertyTaxRatePct: 1.0,
  },
  social: {
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/",
    linkedin: "https://linkedin.com/",
  },
  /** Extra consumer-notice links for the footer (some states require them; Georgia doesn't). */
  legalLinks: [] as { label: string; href: string }[],
  /** Areas linked from the homepage hero and footer. */
  featuredAreas: ["Buckhead", "Virginia-Highland", "Decatur", "Midtown", "Alpharetta"],
} as const;

export const nav = [
  { label: "Buy", href: "/homes" },
  { label: "Rent", href: "/homes?mode=rent" },
  { label: "Sell", href: "/sell" },
  { label: "Agents", href: "/agents" },
] as const;
