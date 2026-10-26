import { site } from "@/config/site";

/** Display formatting shared by server and client components. */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-US");

export function formatPrice(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : usd.format(n);
}

/** Compact price for map pins: $725K, $1.25M. */
export function formatPriceShort(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m >= 10 ? m.toFixed(1).replace(/\.0$/, "") : m.toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : num.format(n);
}

export function formatBaths(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatLot(sqft: number | null | undefined): string {
  if (!sqft) return "—";
  return sqft >= 21_780
    ? `${(sqft / 43_560).toFixed(2).replace(/\.?0+$/, "")} acres`
    : `${num.format(sqft)} sqft lot`;
}

type AddressLike = {
  addressLine1: string;
  unitNumber?: string | null;
  city: string;
  state: string;
  postalCode: string;
  hideAddress?: boolean;
};

const PLACEHOLDERS = new Set(["none", "n/a", "na", "-", "0"]);

/**
 * Empty, or a feed's stand-in for "no value" ("None", "N/A", "-", "0"), as
 * Georgia MLS sends in SubdivisionName. Such values are never shown or linked.
 */
export function isNullLike(v: string | null | undefined): boolean {
  const t = v?.trim().toLowerCase();
  return !t || PLACEHOLDERS.has(t);
}

const UNIT_DESIGNATOR = /^(lot|unit|apt|ste|suite|bldg)\b\.?\s*/i;

/**
 * A unit as shown after the street: "317" and "#317" → "#317", "A AND B" →
 * "#A & B", "LOT 8" → "Lot 8" (a designator word needs no "#"). Null when empty.
 */
export function formatUnit(unitNumber: string | null | undefined): string | null {
  const unit = unitNumber?.replace(/^[\s#]+/, "").trim();
  if (!unit) return null;
  const designator = UNIT_DESIGNATOR.exec(unit);
  if (designator) {
    const word = designator[1];
    const rest = unit.slice(designator[0].length).trim();
    const title = word[0].toUpperCase() + word.slice(1).toLowerCase();
    return rest ? `${title} ${rest}` : title;
  }
  return `#${unit.replace(/\s+and\s+/gi, " & ")}`;
}

export function formatStreet(
  a: Pick<AddressLike, "addressLine1" | "unitNumber" | "hideAddress">,
): string {
  if (a.hideAddress) return "Address withheld by seller";
  const unit = formatUnit(a.unitNumber);
  return unit ? `${a.addressLine1} ${unit}` : a.addressLine1;
}

export function formatCityLine(a: AddressLike): string {
  return `${a.city}, ${a.state} ${a.postalCode}`;
}

export function formatFullAddress(a: AddressLike): string {
  return a.hideAddress ? formatCityLine(a) : `${formatStreet(a)}, ${formatCityLine(a)}`;
}

export const STATUS_LABELS: Record<string, string> = {
  coming_soon: "Coming soon",
  active: "For sale",
  active_under_contract: "Under contract",
  pending: "Pending",
  closed: "Sold",
  withdrawn: "Off market",
  expired: "Off market",
  canceled: "Off market",
};

export function statusLabel(status: string, transactionType?: string): string {
  if (status === "active" && transactionType === "rent") return "For rent";
  if (status === "closed" && transactionType === "rent") return "Rented";
  return STATUS_LABELS[status] ?? status;
}

/** Staff-facing: like `statusLabel`, but tells the off-market statuses apart for the dashboard. */
export function staffStatusLabel(status: string, transactionType?: string): string {
  if (status === "withdrawn") return "Withdrawn";
  if (status === "expired") return "Expired";
  if (status === "canceled") return "Canceled";
  return statusLabel(status, transactionType);
}

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  single_family: "Single-family home",
  condo: "Condo",
  townhouse: "Townhome",
  multi_family: "Multi-family",
  manufactured: "Manufactured home",
  land: "Land",
  farm_ranch: "Farm / ranch",
  commercial: "Commercial",
  other: "Other",
};

/** Whole days since `isoDate` (YYYY-MM-DD). Negative for future dates. */
export function daysSince(
  isoDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!isoDate) return null;
  const then = Date.parse(`${isoDate}T12:00:00Z`);
  return Math.floor((now.getTime() - then) / 86_400_000);
}

export function daysOnMarketLabel(isoDate: string | null | undefined): string | null {
  const d = daysSince(isoDate);
  if (d === null) return null;
  if (d < 0) return "Coming soon";
  if (d === 0) return "Listed today";
  if (d === 1) return "1 day on market";
  return `${d} days on market`;
}

const tz = site.market.timeZone;

export function formatOpenHouse(start: Date | string, end?: Date | string): string {
  const s = new Date(start);
  const day = s.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  const t = (d: Date) =>
    d
      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })
      .replace(":00", "");
  return end ? `${day}, ${t(s)}–${t(new Date(end))}` : `${day}, ${t(s)}`;
}

export function formatShortOpenHouse(start: Date | string): string {
  const s = new Date(start);
  const day = s.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
  const time = s.toLocaleTimeString("en-US", { hour: "numeric", timeZone: tz });
  return `Open ${day} ${time.replace(" ", "").toLowerCase()}`;
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date =
    typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
      ? new Date(`${d}T12:00:00Z`)
      : new Date(d);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });
}

export function formatRelative(d: Date | string, now: Date = new Date()): string {
  const diff = (now.getTime() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86_400 * 7) return `${Math.floor(diff / 86_400)}d ago`;
  return formatDate(d);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Calendar year of `d` in the market time zone. */
function yearIn(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", timeZone: tz });
}

/** Whole-dollar monthly amount: $3,412/mo. */
export function formatMonthly(n: number): string {
  return `${usd.format(Math.round(n))}/mo`;
}

/** Compact thousands: $950, $3.4K, $12.5K, $125K, $1.25M (no "/mo"). */
function compactDollars(n: number): string {
  const v = Math.round(Math.abs(n));
  if (v >= 1_000_000) return formatPriceShort(v);
  if (v >= 100_000) return `$${Math.round(v / 1_000)}K`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${v}`;
}

/** Compact monthly amount for pins and chips: $3.4K/mo, $950/mo. */
export function formatMonthlyShort(n: number): string {
  return `${compactDollars(n)}/mo`;
}

/**
 * Terse age for rows and chips: "now", "6m", "3h", "3d", then a date
 * ("Oct 2", or "Oct 2, 2025" outside the current year) in the market time zone.
 */
export function formatRelativeShort(d: Date | string, now: Date = new Date()): string {
  const date = new Date(d);
  const secs = (now.getTime() - date.getTime()) / 1000;
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 86_400 * 7) return `${Math.floor(secs / 86_400)}d`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: yearIn(date) === yearIn(now) ? undefined : "numeric",
    timeZone: tz,
  });
}

/** The latest listing event, as selected for saved-home rows. */
export type ChangeEvent = {
  type: "listed" | "price_change" | "status_change" | "sold" | "relisted" | "removed";
  price?: number | null;
  previousPrice?: number | null;
  toStatus?: string | null;
  occurredAt: Date | string;
};

/**
 * Short label for "what changed since you saved it": "Price cut $25K · 3d",
 * "Price up $10K · 1d", "Now pending", "Sold", "Back on market". Null when
 * there is nothing worth showing.
 */
export function formatChangeChip(e: ChangeEvent, now: Date = new Date()): string | null {
  switch (e.type) {
    case "price_change": {
      if (!e.price || !e.previousPrice || e.price === e.previousPrice) return null;
      const diff = e.price - e.previousPrice;
      // Small amounts (rent changes) stay exact: "$150", "$1,500".
      const amount = Math.abs(diff) < 10_000 ? usd.format(Math.abs(diff)) : compactDollars(diff);
      return `${diff < 0 ? "Price cut" : "Price up"} ${amount} · ${formatRelativeShort(e.occurredAt, now)}`;
    }
    case "sold":
      return "Sold";
    case "relisted":
      return "Back on market";
    case "removed":
      return "Off market";
    case "listed":
      return "Newly listed";
    case "status_change":
      switch (e.toStatus) {
        case "pending":
        case "active_under_contract":
          return "Now pending";
        case "active":
          return "Back on market";
        case "coming_soon":
          return "Coming soon";
        case "closed":
          return "Sold";
        case "withdrawn":
        case "expired":
        case "canceled":
          return "Off market";
        default:
          return null;
      }
  }
}

/** A feed older than this is stale: pages must not claim "Updated N min ago". */
export const STALE_FEED_MS = 2 * 60 * 60 * 1000;

export type Freshness = {
  stale: boolean;
  /** "Updated 12 min ago" — only when fresh; append " from <source>" as needed. */
  label: string | null;
  /** "Listing data last updated Sep 25, 9:14 AM — it may be out of date" — only when stale. */
  notice: string | null;
};

/**
 * How current the listing feed is. A missing sync time counts as stale, so the
 * app never makes a freshness claim it can't back up.
 */
export function freshness(
  lastSyncedAt: Date | string | null | undefined,
  now: Date = new Date(),
): Freshness {
  if (!lastSyncedAt) {
    return { stale: true, label: null, notice: "Listing data may be out of date" };
  }
  const at = new Date(lastSyncedAt);
  const age = now.getTime() - at.getTime();
  if (!Number.isFinite(age) || age > STALE_FEED_MS) {
    const when = Number.isFinite(age)
      ? at.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: yearIn(at) === yearIn(now) ? undefined : "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: tz,
        })
      : null;
    return {
      stale: true,
      label: null,
      notice: when
        ? `Listing data last updated ${when} — it may be out of date`
        : "Listing data may be out of date",
    };
  }
  const mins = Math.floor(Math.max(0, age) / 60_000);
  const label =
    mins < 1
      ? "Updated just now"
      : mins < 60
        ? `Updated ${mins} min ago`
        : `Updated ${Math.floor(mins / 60)} hr ago`;
  return { stale: false, label, notice: null };
}

/**
 * Cuts text to at most `max` characters at a word boundary, ending in "…"
 * (no space or punctuation left before it). Text that fits is unchanged.
 */
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

/** A listing's meta description from its remarks: whitespace collapsed, cut at a word. */
export function listingMetaDescription(remarks: string, max = 160): string {
  return cutAtWord(remarks.replace(/\s+/g, " ").trim(), max);
}
