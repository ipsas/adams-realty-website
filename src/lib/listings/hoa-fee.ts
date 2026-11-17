/**
 * HOA fee frequencies: the one place that parses, labels and converts them, for the
 * mapper, the listing page, the cost estimate and the search's max-HOA filter. Pure.
 * A fee whose period the MLS doesn't give is shown without one and left out of
 * monthly-cost math: never guessed as monthly.
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { formatPrice } from "@/lib/format";

/** RESO Data Dictionary 2.x FeeFrequency lookups, as stored in `listings.hoa_frequency`. */
export const HOA_FREQUENCIES = [
  "monthly",
  "quarterly",
  "semi_annually",
  "annually",
  "bi_monthly",
  "semi_monthly",
  "bi_weekly",
  "weekly",
  "daily",
  "one_time",
  "seasonal",
] as const;

export type HoaFrequency = (typeof HOA_FREQUENCIES)[number];

export function isHoaFrequency(v: unknown): v is HoaFrequency {
  return typeof v === "string" && (HOA_FREQUENCIES as readonly string[]).includes(v);
}

/** Whole normalized values (lowercase, no spaces, hyphens or underscores). */
const PARSE: Record<string, HoaFrequency> = {
  monthly: "monthly",
  quarterly: "quarterly",
  semiannually: "semi_annually",
  semiannual: "semi_annually",
  everysixmonths: "semi_annually",
  annually: "annually",
  annual: "annually",
  yearly: "annually",
  bimonthly: "bi_monthly",
  semimonthly: "semi_monthly",
  biweekly: "bi_weekly",
  weekly: "weekly",
  daily: "daily",
  onetime: "one_time",
  seasonal: "seasonal",
};

/** A RESO FeeFrequency value ("Monthly", "Semi-Annually", "One Time"…); anything else is null. */
export function parseFeeFrequency(raw: unknown): HoaFrequency | null {
  if (typeof raw !== "string") return null;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  return Object.hasOwn(PARSE, key) ? PARSE[key] : null;
}

/** Long and short suffixes ("$1,200/year", "$600/yr"). */
const SUFFIX: Record<HoaFrequency, { long: string; short: string }> = {
  monthly: { long: "/month", short: "/mo" },
  quarterly: { long: "/quarter", short: "/qtr" },
  annually: { long: "/year", short: "/yr" },
  semi_annually: { long: "/6 months", short: "/6 mo" },
  bi_monthly: { long: "/2 months", short: "/2 mo" },
  weekly: { long: "/week", short: "/wk" },
  bi_weekly: { long: "/2 weeks", short: "/2 wks" },
  daily: { long: "/day", short: "/day" },
  semi_monthly: { long: " semi-monthly", short: " semi-monthly" },
  one_time: { long: " one-time", short: " one-time" },
  seasonal: { long: " seasonal", short: " seasonal" },
};

/** "$500/year" (long) or "$500/yr" (short); with no known frequency, just "$500". */
export function formatHoaFee(
  fee: number,
  frequency: HoaFrequency | null,
  style: "long" | "short",
): string {
  return formatPrice(fee) + (frequency ? SUFFIX[frequency][style] : "");
}

/**
 * Monthly equivalent = fee × mul / div. One-time and seasonal fees have none. Shared by
 * `monthlyHoaEquivalent` and `monthlyHoaSql` so JS and SQL can't drift.
 */
export const MONTHLY_FACTORS: Partial<Record<HoaFrequency, { mul: number; div: number }>> = {
  monthly: { mul: 1, div: 1 },
  quarterly: { mul: 1, div: 3 },
  semi_annually: { mul: 1, div: 6 },
  annually: { mul: 1, div: 12 },
  bi_monthly: { mul: 1, div: 2 },
  semi_monthly: { mul: 2, div: 1 },
  weekly: { mul: 52, div: 12 },
  bi_weekly: { mul: 26, div: 12 },
  daily: { mul: 365, div: 12 },
};

/** The fee per month, or null when there's no fee or its period has no monthly equivalent. */
export function monthlyHoaEquivalent(
  fee: number | null | undefined,
  frequency: string | null | undefined,
): number | null {
  if (!fee || !isHoaFrequency(frequency)) return null;
  const f = MONTHLY_FACTORS[frequency];
  return f ? (fee * f.mul) / f.div : null;
}

/** SQL monthly equivalent of a fee column by its frequency column: NULL when unknown. */
export function monthlyHoaSql(fee: AnyColumn | SQL, frequency: AnyColumn | SQL): SQL {
  const whens = Object.entries(MONTHLY_FACTORS).map(
    ([k, f]) => sql`when ${sql.raw(`'${k}'`)} then ${fee} * ${sql.raw(`${f.mul} / ${f.div}.0`)}`,
  );
  return sql`(case ${frequency} ${sql.join(whens, sql` `)} else null end)`;
}

/**
 * The amount the search's max-HOA filter compares (with `hoaFilterAmountSql`, its SQL
 * twin): null when there is no fee. A fee with a known period is compared by its monthly
 * equivalent from MONTHLY_FACTORS ($500/yr → 41.67 passes Max $50). A fee with no monthly
 * equivalent (unknown period, one-time, seasonal, anything non-convertible) is compared at
 * its full raw amount, so "No HOA fee" (maxHoa=0) never returns a listing with a fee above
 * $0 and Max $50 never passes a $500 fee of unknown period.
 */
export function hoaFilterAmount(
  fee: number | null,
  frequency: string | null | undefined,
): number | null {
  if (fee === null) return null;
  return monthlyHoaEquivalent(fee, frequency) ?? fee;
}

/**
 * SQL form of `hoaFilterAmount`: `coalesce(<monthly equivalent>, <fee>)`, so a fee with no
 * monthly equivalent is compared at its full raw amount, never let through as unknown.
 * NULL only when the fee itself is NULL.
 */
export function hoaFilterAmountSql(fee: AnyColumn | SQL, frequency: AnyColumn | SQL): SQL {
  return sql`coalesce(${monthlyHoaSql(fee, frequency)}, ${fee})`;
}
