/**
 * Land and farms (site review #8). Land buyers compare tracts by acreage and
 * price per acre, and a tract with no house has no home to insure. Pure and
 * shared by cards, map previews, the listing page, area stats and the
 * dashboard's lot-size field, so every place says the same thing.
 */

export const SQFT_PER_ACRE = 43_560;

type LandLike = {
  propertyType: string;
  livingAreaSqft?: number | null;
  bedrooms?: number | null;
};

/** Land and farm listings: shown and compared by acreage. */
export function isLandType(propertyType: string): boolean {
  return propertyType === "land" || propertyType === "farm_ranch";
}

/**
 * Land with no house on it: a land or farm listing with no living area and no
 * bedrooms. Its estimate has no home insurance, its page no house-only rows,
 * and it is described as "Land · X acres" everywhere.
 */
export function isBareLand(l: LandLike): boolean {
  return isLandType(l.propertyType) && !(l.livingAreaSqft && l.livingAreaSqft > 0) && !l.bedrooms;
}

/** Lot size in acres, or null without one. */
export function acresOf(lotSqft: number | null | undefined): number | null {
  return lotSqft && lotSqft > 0 ? lotSqft / SQFT_PER_ACRE : null;
}

/**
 * "166 acres", "12.5 acres", "0.52 acres", "1 acre": whole acres from 100 up,
 * one decimal from 10, two below, without trailing zeros.
 */
export function formatAcres(lotSqft: number | null | undefined): string {
  const a = acresOf(lotSqft);
  if (a === null) return "—";
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  const text = a.toFixed(digits).replace(/\.?0+$/, "");
  // Rounds to zero only for a sliver of a lot: say how small.
  if (text === "0") return "under 0.01 acres";
  return `${text} ${text === "1" ? "acre" : "acres"}`;
}

/** Price per acre in whole dollars, or null without a price or a lot size. */
export function pricePerAcre(
  price: number | null | undefined,
  lotSqft: number | null | undefined,
): number | null {
  const a = acresOf(lotSqft);
  if (!price || price <= 0 || a === null) return null;
  return Math.round(price / a);
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$8,434/acre", or null when there's nothing to divide. */
export function formatPricePerAcre(
  price: number | null | undefined,
  lotSqft: number | null | undefined,
): string | null {
  const ppa = pricePerAcre(price, lotSqft);
  return ppa === null ? null : `${usd.format(ppa)}/acre`;
}

/** "Land · 12.5 acres" (or "Farm · …"), for bare land in one line. */
export function landFacts(l: LandLike & { lotSizeSqft?: number | null }): string {
  const noun = l.propertyType === "farm_ranch" ? "Farm" : "Land";
  return l.lotSizeSqft ? `${noun} · ${formatAcres(l.lotSizeSqft)}` : noun;
}

/**
 * The one-line facts for bare land, "Land · 12.5 acres · $8,400/acre" (cards, the
 * map preview, the phone strip), or null for anything with a house.
 */
export function landSummary(
  l: LandLike & { lotSizeSqft?: number | null; price?: number | null },
): string | null {
  if (!isBareLand(l)) return null;
  return [landFacts(l), formatPricePerAcre(l.price, l.lotSizeSqft)].filter(Boolean).join(" · ");
}

/** Shown with a bare-land estimate instead of home-loan assumptions. */
export const LAND_LOAN_NOTE = "Land loan: terms vary; check with your lender";

/**
 * The dashboard's lot-size field takes acres or square feet (it starts on
 * acres); the database keeps square feet. Null for an empty or invalid value.
 */
export type LotUnit = "acres" | "sqft";

export function lotSizeToSqft(value: number | null | undefined, unit: LotUnit): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return Math.round(unit === "acres" ? value * SQFT_PER_ACRE : value);
}

/** The field's value in `unit` for a stored square-foot figure ("" when there is none). */
export function lotSizeInUnit(sqft: number | null | undefined, unit: LotUnit): string {
  if (sqft === null || sqft === undefined) return "";
  if (unit === "sqft") return String(sqft);
  // Six decimals (0.04 sq ft) bring any whole square-foot figure back exactly.
  return String(Number((sqft / SQFT_PER_ACRE).toFixed(6)));
}
