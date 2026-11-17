/**
 * The sync's HOA fee guard: re-derives each raw record's fee and period on its own
 * (the record's AssociationFeeFrequency, else annual for a Georgia MLS `GAMLS2_` record,
 * else none) and compares them, and the text the page shows, with the mapped listing.
 * Pure. The counts carry no listing keys, addresses or contact details.
 */
import { formatHoaFee, parseFeeFrequency, type HoaFrequency } from "@/lib/listings/hoa-fee";
import type { MapResult } from "../types";
import type { ResoProperty } from "./mapper";

export type FeeCheck = {
  /** Mapped listings with a fee above $0 in the raw record or the mapped one. */
  checked: number;
  mismatched: number;
  /** Distinct raw AssociationFeeFrequency values that aren't a RESO FeeFrequency. */
  unrecognizedFrequency: Record<string, number>;
};

/** RESO AssociationYN "no" spellings: the fee is then left out. */
const NO_ASSOCIATION: unknown[] = [false, "false", "N", "No", 0];

function rawFee(p: ResoProperty): number | null {
  if (NO_ASSOCIATION.includes(p.AssociationYN)) return null;
  const v = p.AssociationFee;
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && Math.round(n) > 0 ? Math.round(n) : null;
}

/** The raw AssociationFeeFrequency as sent, or null when the record has none. */
function rawFrequency(p: ResoProperty): string | null {
  const v = p.AssociationFeeFrequency;
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s || null;
}

function rawPeriod(p: ResoProperty): HoaFrequency | null {
  const raw = rawFrequency(p);
  if (raw) return parseFeeFrequency(raw);
  return Object.keys(p).some((k) => k.startsWith("GAMLS2_")) ? "annually" : null;
}

export function feeDisplayMismatches(raw: ResoProperty[], mapped: MapResult[]): FeeCheck {
  const out: FeeCheck = { checked: 0, mismatched: 0, unrecognizedFrequency: {} };
  raw.forEach((p, i) => {
    const m = mapped[i];
    if (!m?.ok) return;
    const fee = rawFee(p);
    const { hoaFee, hoaFrequency } = m.listing;
    const mappedFee = hoaFee != null && hoaFee > 0 ? hoaFee : null;
    if (fee === null && mappedFee === null) return;
    out.checked++;
    const period = fee === null ? null : rawPeriod(p);
    const freq = rawFrequency(p);
    if (fee !== null && freq && period === null) {
      const key = freq.slice(0, 40);
      out.unrecognizedFrequency[key] = (out.unrecognizedFrequency[key] ?? 0) + 1;
    }
    const ok =
      mappedFee === fee &&
      (hoaFrequency ?? null) === period &&
      (fee === null ||
        (formatHoaFee(mappedFee!, hoaFrequency ?? null, "long") ===
          formatHoaFee(fee, period, "long") &&
          formatHoaFee(mappedFee!, hoaFrequency ?? null, "short") ===
            formatHoaFee(fee, period, "short")));
    if (!ok) out.mismatched++;
  });
  return out;
}

/** The page's one warning line, or null when every fee matched and every period was known. */
export function feeCheckWarning(c: FeeCheck): string | null {
  const unknown = Object.entries(c.unrecognizedFrequency);
  if (!c.mismatched && !unknown.length) return null;
  const values = unknown.map(([v, n]) => `${JSON.stringify(v)}×${n}`).join(", ");
  return `HOA fee check: ${c.mismatched} of ${c.checked} fees mismatched the raw MLS data; unrecognized AssociationFeeFrequency: ${values || "none"}`;
}

/** A FeeCheck of nothing checked, to sum pages into (addFeeCheck). */
export const emptyFeeCheck = (): FeeCheck => ({
  checked: 0,
  mismatched: 0,
  unrecognizedFrequency: {},
});

/** Adds `page` into `total` (the sync sums its pages' checks over a run). */
export function addFeeCheck(total: FeeCheck, page: FeeCheck): FeeCheck {
  total.checked += page.checked;
  total.mismatched += page.mismatched;
  for (const [value, n] of Object.entries(page.unrecognizedFrequency)) {
    total.unrecognizedFrequency[value] = (total.unrecognizedFrequency[value] ?? 0) + n;
  }
  return total;
}
