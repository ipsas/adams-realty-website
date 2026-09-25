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

export function formatStreet(a: AddressLike): string {
  if (a.hideAddress) return "Address withheld by seller";
  return a.unitNumber ? `${a.addressLine1} #${a.unitNumber}` : a.addressLine1;
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
