/**
 * The listing page's "Property details": the MLS's own values under standard
 * RESO labels, grouped. Pure. Empty values are left out, and nothing about
 * compensation, showings, lockboxes or occupants is ever listed here: no row
 * is read from, or labelled as, an excluded field (./excluded-fields.ts).
 */
import type { ListingFeatures } from "@/db/schema";
import { formatPrice, isNullLike } from "@/lib/format";
import { MAX_PLAUSIBLE_LOT_SQFT } from "@/lib/search/query";
import { isExcludedField, withoutExcludedFields } from "./excluded-fields";
import { formatAcres } from "./land";
import { normalizeTaxYear } from "./tax-year";

export type DetailRow = { label: string; value: string };
export type DetailGroup = { title: string; rows: DetailRow[] };

export type DetailListing = {
  features: ListingFeatures;
  fireplacesTotal: number | null;
  parkingTotal: number | null;
  garageSpaces: number | null;
  lotSizeSqft: number | null;
  lotSizeDimensions: string | null;
  neighborhood: string | null;
  associationYN: boolean | null;
  hoaFee: number | null;
  hoaFrequency: "monthly" | "quarterly" | "annually" | null;
  seniorCommunity: boolean | null;
  taxAnnualAmount: number | null;
  taxYear: number | null;
  taxAssessedValue: number | null;
  zoning: string | null;
};

type HoaLike = Pick<DetailListing, "associationYN" | "hoaFee" | "hoaFrequency">;

const FREQUENCY = { monthly: "month", quarterly: "quarter", annually: "year" } as const;
const FREQUENCY_SHORT = { monthly: "mo", quarterly: "qtr", annually: "yr" } as const;

/**
 * Whether a listing has an HOA, the one rule for the page and the HOA search filter
 * (buildConditions in src/lib/search/query.ts): a true AssociationYN or a fee above $0 is
 * yes; otherwise AssociationYN false or a $0 fee is no; anything else is unknown (null).
 */
export function hoaStatus(l: Pick<HoaLike, "associationYN" | "hoaFee">): boolean | null {
  if (l.associationYN === true || (l.hoaFee !== null && l.hoaFee > 0)) return true;
  if (l.associationYN === false || l.hoaFee === 0) return false;
  return null;
}

/**
 * The dashboard editor's AssociationYN for its HOA fee (the editor has no HOA checkbox):
 * a fee above $0 means there is an HOA; a cleared or $0 fee leaves it unknown (null), so a
 * flag set by an earlier fee never outlives it. A $0 fee still reads "no" by `hoaStatus`.
 */
export function editorAssociationYN(hoaFee: number | null | undefined): boolean | null {
  return hoaFee != null && hoaFee > 0 ? true : null;
}

/**
 * The facts grid's HOA: the fee when there is one, "Yes" for an association with no fee
 * stated, "None" only when the MLS says there is no association (or a $0 fee), and null
 * (no fact) when it doesn't say.
 */
export function hoaFact(l: HoaLike): string | null {
  if (l.hoaFee && l.hoaFee > 0) {
    return `${formatPrice(l.hoaFee)}/${FREQUENCY_SHORT[l.hoaFrequency ?? "monthly"]}`;
  }
  const status = hoaStatus(l);
  return status === null ? null : status ? "Yes" : "None";
}

function hoaYesNo(l: HoaLike): string | null {
  const status = hoaStatus(l);
  return status === null ? null : status ? "Yes" : "No";
}

/** isNullLike, plus a literal "null" or "undefined" left in the data by a bad export. */
function blank(s: string | null | undefined): boolean {
  return isNullLike(s) || /^(null|undefined)$/i.test(s!.trim());
}

function list(items: string[] | undefined): string | null {
  const kept = (items ?? [])
    .filter((s): s is string => typeof s === "string" && !blank(s))
    .map((s) => s.trim());
  return kept.length ? kept.join(", ") : null;
}

function count(n: number | null): string | null {
  return n !== null && n > 0 ? String(n) : null;
}

function text(s: string | null): string | null {
  return s && !blank(s) ? s.trim() : null;
}

function money(n: number | null): string | null {
  return n !== null && n > 0 ? formatPrice(n) : null;
}

export function listingDetailGroups(l: DetailListing): DetailGroup[] {
  // Guarded: features stored under an excluded key are never read.
  const f: ListingFeatures = withoutExcludedFields(l.features ?? {});
  const taxYear = normalizeTaxYear(l.taxYear);
  const tax = money(l.taxAnnualAmount);
  const groups: [string, [string, string | null][]][] = [
    [
      "Interior",
      [
        ["Fireplaces", count(l.fireplacesTotal)],
        ["Fireplace features", list(f.fireplace)],
        ["Basement", list(f.basement)],
        ["Laundry", list(f.laundry)],
        ["Windows", list(f.windows)],
        ["Accessibility", list(f.accessibility)],
        ["Security", list(f.security)],
        ["Levels", list(f.levels)],
      ],
    ],
    [
      "Exterior and lot",
      [
        [
          "Lot size",
          l.lotSizeSqft && l.lotSizeSqft > 0 && l.lotSizeSqft <= MAX_PLAUSIBLE_LOT_SQFT
            ? formatAcres(l.lotSizeSqft)
            : null,
        ],
        ["Lot size dimensions", text(l.lotSizeDimensions)],
        ["Patio and porch", list(f.patioPorch)],
        ["Fencing", list(f.fencing)],
        ["Other structures", list(f.otherStructures)],
        ["Waterfront features", list(f.waterfront)],
        ["Road frontage", list(f.roadFrontage)],
        ["Road surface", list(f.roadSurface)],
        ["Spa", list(f.spa)],
        ["Horse amenities", list(f.horse)],
      ],
    ],
    [
      "Construction",
      [
        ["Architectural style", list(f.style)],
        ["Construction materials", list(f.construction)],
        ["Roof", list(f.roof)],
        ["Foundation", list(f.foundation)],
        ["Property condition", list(f.condition)],
      ],
    ],
    [
      "Utilities",
      [
        ["Sewer", list(f.sewer)],
        ["Water source", list(f.water)],
        ["Electric", list(f.electric)],
        ["Utilities", list(f.utilities)],
        ["Green energy", list(f.greenEnergy)],
      ],
    ],
    [
      "Parking",
      [
        ["Parking total", count(l.parkingTotal)],
        ["Garage spaces", count(l.garageSpaces)],
        ["Parking features", list(f.parking)],
      ],
    ],
    [
      "Community and HOA",
      [
        ["Subdivision", text(l.neighborhood)],
        ["HOA", hoaYesNo(l)],
        [
          "HOA fee",
          l.hoaFee && l.hoaFee > 0
            ? `${formatPrice(l.hoaFee)}/${FREQUENCY[l.hoaFrequency ?? "monthly"]}`
            : null,
        ],
        ["Association fee includes", list(f.associationFeeIncludes)],
        ["Association amenities", list(f.associationAmenities)],
        ["Community features", list(f.community)],
        ["55+ community", l.seniorCommunity === true ? "Yes" : null],
      ],
    ],
    [
      "Taxes and financial",
      [
        ["Annual tax amount", tax && (taxYear ? `${tax} (${taxYear})` : tax)],
        ["Tax assessed value", money(l.taxAssessedValue)],
        ["Listing terms", list(f.listingTerms)],
        ["Special listing conditions", list(f.specialConditions)],
        ["Zoning", text(l.zoning)],
        ["Current use", list(f.currentUse)],
        ["Possible use", list(f.possibleUse)],
      ],
    ],
  ];
  return groups
    .map(([title, rows]) => ({
      title,
      rows: rows
        .filter((r): r is [string, string] => r[1] !== null && !isExcludedField(r[0]))
        .map(([label, value]) => ({ label, value })),
    }))
    .filter((g) => g.rows.length > 0);
}
