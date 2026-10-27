import { isNullLike } from "@/lib/format";
import { EXCLUDED_FIELDS, withoutExcludedFields } from "@/lib/listings/excluded-fields";
import { normalizeTaxYear } from "@/lib/listings/tax-year";
import type { MapResult, NormalizedListing, NormalizedMedia, NormalizedOpenHouse } from "../types";

/**
 * Bump whenever mapResoProperty's output changes for the same input: the next
 * incremental sync then rewrites every stored row once (sync-engine.ts), since
 * their ModificationTimestamp alone wouldn't make it.
 * 2: GAMLS2_Latitude/Longitude and Coordinates, placeholder subdivisions, 2-digit tax years.
 * 3: AssociationYN, detail columns (fireplaces, parking, 55+, assessed value, zoning…), more feature lists.
 * 4: MainLevelBedrooms and primary bedroom on main.
 */
export const RESO_MAPPER_VERSION = 4;

/**
 * Maps a RESO Data Dictionary 2.x `Property` record (as returned by any
 * RESO Web API: Bridge, Trestle, Spark, MLS Grid, …) to our normalized
 * listing. Pure — no I/O — so every edge case is covered by unit tests.
 *
 * Vendors differ in small ways this tolerates: multi-value lookups arrive as
 * arrays or comma-separated strings, booleans may be missing, and numbers
 * sometimes arrive as strings.
 */

export type ResoMedia = {
  MediaKey?: string;
  MediaURL?: string;
  Order?: number;
  ShortDescription?: string | null;
  LongDescription?: string | null;
  MediaCategory?: string | null;
  ImageWidth?: number | null;
  ImageHeight?: number | null;
};

export type ResoOpenHouse = {
  OpenHouseKey?: string;
  OpenHouseStartTime?: string;
  OpenHouseEndTime?: string;
  OpenHouseType?: string | null;
  OpenHouseRemarks?: string | null;
};

export type ResoProperty = Record<string, unknown> & {
  ListingKey?: string;
  Media?: ResoMedia[];
  OpenHouse?: ResoOpenHouse[];
};

type Status = NormalizedListing["status"];
type PropertyType = NormalizedListing["propertyType"];

const STATUS_MAP: Record<string, Status> = {
  active: "active",
  "active under contract": "active_under_contract",
  "coming soon": "coming_soon",
  pending: "pending",
  closed: "closed",
  withdrawn: "withdrawn",
  hold: "withdrawn",
  "on hold": "withdrawn",
  expired: "expired",
  canceled: "canceled",
  cancelled: "canceled",
};

const SUBTYPE_MAP: Record<string, PropertyType> = {
  "single family residence": "single_family",
  "single family": "single_family",
  condominium: "condo",
  condo: "condo",
  "stock cooperative": "condo",
  apartment: "condo",
  townhouse: "townhouse",
  "manufactured home": "manufactured",
  "manufactured on land": "manufactured",
  "mobile home": "manufactured",
  duplex: "multi_family",
  triplex: "multi_family",
  quadruplex: "multi_family",
  "multi family": "multi_family",
  farm: "farm_ranch",
  ranch: "farm_ranch",
  "unimproved land": "land",
  "residential lot": "land",
  lot: "land",
};

/**
 * RESO `PropertyType` → our type and transaction. `fixed` types ignore the
 * subtype: a Commercial Sale record's "Apartment" or "Multi Family" subtype is
 * an apartment building or a lot sold as investment real estate, not a condo
 * or a duplex someone lives in.
 */
const TYPE_FALLBACK: Record<string, { type: PropertyType; rent: boolean; fixed?: boolean }> = {
  residential: { type: "single_family", rent: false },
  "residential lease": { type: "single_family", rent: true },
  "residential income": { type: "multi_family", rent: false },
  land: { type: "land", rent: false },
  farm: { type: "farm_ranch", rent: false },
  "manufactured in park": { type: "manufactured", rent: false },
  "commercial sale": { type: "commercial", rent: false, fixed: true },
  "commercial lease": { type: "commercial", rent: true, fixed: true },
  "business opportunity": { type: "commercial", rent: false, fixed: true },
};

// --- small coercion helpers -------------------------------------------------

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number") return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "Y" || v === "Yes" || v === 1) return true;
  if (v === "false" || v === "N" || v === "No" || v === 0) return false;
  return null;
}

/** RESO multi-value lookups: arrays, or comma-separated strings on some vendors. */
export function list(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return raw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => !isNullLike(x))
    .map(humanizeLookup);
}

/** Each field's `list()`, keeping only the non-empty ones. */
function nonEmptyLists<K extends string>(fields: Record<K, unknown>): Partial<Record<K, string[]>> {
  const out: Partial<Record<K, string[]>> = {};
  for (const [key, v] of Object.entries(fields) as [K, unknown][]) {
    const values = list(v);
    if (values.length) out[key] = values;
  }
  return out;
}

/** "GraniteCounters" → "Granite Counters"; leaves already-spaced values alone. */
function humanizeLookup(s: string): string {
  return s.includes(" ") ? s : s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function date(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

function timestamp(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// --- field mappers -----------------------------------------------------------

export function mapStatus(v: unknown): Status | null {
  const s = str(v)?.toLowerCase();
  return s ? (STATUS_MAP[s] ?? null) : null;
}

export function mapPropertyType(
  type: unknown,
  subType: unknown,
): { propertyType: PropertyType; transactionType: "sale" | "rent" } | null {
  const t = str(type)?.toLowerCase() ?? "";
  const fallback = TYPE_FALLBACK[t];
  if (!fallback) return null;
  const sub = str(subType)?.toLowerCase();
  const fromSub = sub && !fallback.fixed ? SUBTYPE_MAP[sub] : undefined;
  return {
    propertyType: fromSub ?? fallback.type,
    transactionType: fallback.rent ? "rent" : "sale",
  };
}

/** Months per `LeaseAmountFrequency` period (RESO lookup values). */
const LEASE_MONTHS: Record<string, number> = {
  monthly: 1,
  "bi-monthly": 2,
  quarterly: 3,
  "semi-annually": 6,
  annually: 12,
};

/**
 * Rentals are stored as a monthly rent. Commercial leases often quote the rent
 * per year (or quarter) in `LeaseAmount` + `LeaseAmountFrequency`; when both are
 * present and the frequency is one we can convert, use them. Otherwise fall
 * back to `ListPrice`, which residential feeds already send as monthly rent.
 */
export function monthlyLeaseAmount(p: ResoProperty): number | null {
  const amount = num(p.LeaseAmount);
  const months = LEASE_MONTHS[str(p.LeaseAmountFrequency)?.toLowerCase() ?? ""];
  if (amount === null || amount <= 0 || !months) return null;
  return Math.round(amount / months);
}

export function formatStreet(p: ResoProperty): string | null {
  const parts = [
    str(p.StreetNumber),
    str(p.StreetDirPrefix),
    str(p.StreetName),
    str(p.StreetSuffix),
    str(p.StreetDirSuffix),
  ].filter(Boolean);
  if (parts.length >= 2) return parts.join(" ");
  // Fall back to the first line of UnparsedAddress ("123 Main St, Royston, GA 30662").
  const unparsed = str(p.UnparsedAddress);
  return unparsed ? unparsed.split(",")[0].trim() : null;
}

function hoaFrequency(v: unknown): NormalizedListing["hoaFrequency"] {
  const s = str(v)?.toLowerCase() ?? "";
  if (s.startsWith("month")) return "monthly";
  if (s.startsWith("quarter")) return "quarterly";
  if (s.startsWith("annual") || s.startsWith("year")) return "annually";
  return null;
}

function mapMedia(media: ResoMedia[] | undefined): NormalizedMedia[] {
  if (!Array.isArray(media)) return [];
  return media
    .filter((m) => typeof m.MediaURL === "string" && /^https?:\/\//.test(m.MediaURL))
    .map((m, i) => {
      const category = (m.MediaCategory ?? "").toLowerCase();
      const kind: NormalizedMedia["kind"] = category.includes("floor")
        ? "floor_plan"
        : category.includes("video")
          ? "video"
          : category.includes("tour")
            ? "virtual_tour"
            : "photo";
      return {
        sourceKey: m.MediaKey ?? null,
        url: m.MediaURL as string,
        kind,
        caption: str(m.ShortDescription) ?? str(m.LongDescription),
        width: int(m.ImageWidth),
        height: int(m.ImageHeight),
        sortOrder: int(m.Order) ?? i,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function mapOpenHouses(rows: ResoOpenHouse[] | undefined): NormalizedOpenHouse[] {
  if (!Array.isArray(rows)) return [];
  const out: NormalizedOpenHouse[] = [];
  for (const r of rows) {
    const startsAt = timestamp(r.OpenHouseStartTime);
    const endsAt = timestamp(r.OpenHouseEndTime);
    if (!startsAt || !endsAt) continue;
    out.push({
      sourceKey: r.OpenHouseKey ?? null,
      type: (r.OpenHouseType ?? "").toLowerCase().includes("virtual") ? "virtual" : "in_person",
      startsAt,
      endsAt,
      remarks: str(r.OpenHouseRemarks),
    });
  }
  return out;
}

// The Georgia MLS excluded fields (Exhibit C) now live with their runtime guard.
export { EXCLUDED_FIELDS };

/** The first non-empty value among keys ending in `suffix` (vendor prefixes vary: GAMLS_, BR_…). */
function bySuffix(p: ResoProperty, suffix: string): string | null {
  const exact = str(p[suffix]);
  if (exact) return exact;
  const lower = suffix.toLowerCase();
  for (const [k, v] of Object.entries(p)) {
    if (k.toLowerCase().endsWith(lower)) {
      const s = str(v);
      if (s) return s;
    }
  }
  return null;
}

/**
 * [lat, lng], or null. Georgia MLS's Bridge dataset leaves the standard
 * Latitude/Longitude null and sends `GAMLS2_Latitude`/`GAMLS2_Longitude`
 * (any `<PREFIX>_Latitude` is read) and a GeoJSON-style `Coordinates`
 * [lng, lat], in that order of preference: the first pair that passes the
 * range check wins. Exported for tests.
 */
export function coordinates(p: ResoProperty): [number, number] | null {
  const geo = Array.isArray(p.Coordinates) && p.Coordinates.length === 2 ? p.Coordinates : [];
  const candidates: [unknown, unknown][] = [
    [p.Latitude, p.Longitude],
    [bySuffix(p, "_Latitude"), bySuffix(p, "_Longitude")],
    // Numbers only: GeoJSON arrays never carry strings.
    [typeof geo[1] === "number" ? geo[1] : null, typeof geo[0] === "number" ? geo[0] : null],
  ];
  for (const [rawLat, rawLng] of candidates) {
    const lat = num(rawLat);
    const lng = num(rawLng);
    const valid =
      lat !== null &&
      lng !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0);
    if (valid) return [lat, lng];
  }
  return null;
}

/** 2-digit years (24) are 2000+; anything outside 1900…next year is noise. Exported for tests. */
export function taxYear(v: unknown, now: Date = new Date()): number | null {
  return normalizeTaxYear(v, now);
}

const EMAIL = /[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/**
 * Georgia MLS's mandatory "Attribution Contact Phone" and "Attribution
 * Contact Email". The field names on the RESO feed are not confirmed yet
 * (docs/plans/gamls-compliance.md), so this takes separate fields ending in
 * AttributionContactPhone / AttributionContactEmail, else picks them out of
 * RESO's single free-text `AttributionContact`. Exported for tests.
 */
export function attribution(p: ResoProperty): {
  attributionPhone: string | null;
  attributionEmail: string | null;
} {
  const combined = str(p.AttributionContact) ?? "";
  return {
    attributionPhone:
      bySuffix(p, "AttributionContactPhone") ?? PHONE.exec(combined)?.[0].trim() ?? null,
    attributionEmail: bySuffix(p, "AttributionContactEmail") ?? EMAIL.exec(combined)?.[0] ?? null,
  };
}

/**
 * Variable Compensation is mandatory when the feed has it (RESO
 * `DualVariableCompensationYN`). Buyer-agency compensation is optional, but
 * wherever it is shown its comments must be shown with it: the comments are
 * kept only alongside an amount, and the listing page renders the two as one
 * block. Exported for tests.
 */
export function compensation(p: ResoProperty): {
  variableCompensation: boolean | null;
  buyerAgencyCompensation: string | null;
  compensationComments: string | null;
} {
  const amount = str(p.BuyerAgencyCompensation);
  const type = str(p.BuyerAgencyCompensationType);
  return {
    variableCompensation: bool(p.DualVariableCompensationYN),
    buyerAgencyCompensation: amount
      ? type && !amount.includes(type)
        ? `${amount} ${type}`
        : amount
      : null,
    compensationComments: amount
      ? (str(p.CompensationComments) ?? str(p.BuyerAgencyCompensationComments))
      : null,
  };
}

/**
 * The InteriorFeatures values that put the primary bedroom on the main level,
 * matched whole and case-insensitively. A full scan of the GAMLS feed on
 * 2026-10-27 (all 403,824 Property records) found only this one; add a value
 * only after it appears in the feed.
 * Whitespace is ignored too, so the camelCase enum form ("MasterOnMainLevel") matches.
 */
export const PRIMARY_ON_MAIN_VALUES = ["Master On Main Level"] as const;
const normalizeFeature = (v: string) => v.toLowerCase().replace(/\s+/g, "");
const PRIMARY_ON_MAIN = new Set<string>(PRIMARY_ON_MAIN_VALUES.map(normalizeFeature));

/**
 * A non-negative whole number: a safe-integer JSON number, or a string of
 * digits only (no sign, spaces, decimals, hex or exponent). Anything else is null.
 */
function strictNonNegInt(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * Main-level bedrooms, from the structured fields only (never the remarks).
 * `MainLevelBedrooms` and `BedroomsTotal` must be strict non-negative integers
 * (strictNonNegInt). `MainLevelBedrooms` counts only when `BedroomsTotal` is
 * known and it is no greater; otherwise unknown. The primary bedroom is on the
 * main level when InteriorFeatures says so (a PRIMARY_ON_MAIN_VALUES value,
 * exact once case and whitespace are ignored) or every bedroom is there, and
 * isn't when no bedroom is; the flag with zero main-level bedrooms conflicts, so
 * unknown. With `BedroomsTotal` 0 it is unknown whatever the flag or count say.
 * A missing flag alone isn't a "no": many one-level homes don't carry it.
 * The v4 remap (RESO_MAPPER_VERSION) fills both columns for stored rows.
 * Exported for tests.
 */
export function mainLevelBedroomFacts(p: ResoProperty): {
  mainLevelBedrooms: number | null;
  primaryBedroomOnMain: boolean | null;
} {
  const total = strictNonNegInt(p.BedroomsTotal);
  const raw = strictNonNegInt(p.MainLevelBedrooms);
  const mainLevelBedrooms = raw !== null && total !== null && raw <= total ? raw : null;
  // Raw values (list() humanizes): only PRIMARY_ON_MAIN_VALUES match, any case/spacing.
  const features = p.InteriorFeatures;
  const rawFeatures: unknown[] = Array.isArray(features)
    ? features
    : typeof features === "string"
      ? features.split(/,\s*/)
      : [];
  const masterFlag = rawFeatures.some(
    (v) => typeof v === "string" && PRIMARY_ON_MAIN.has(normalizeFeature(v)),
  );
  let primaryBedroomOnMain: boolean | null = null;
  if (total === 0) primaryBedroomOnMain = null;
  else if (masterFlag) primaryBedroomOnMain = mainLevelBedrooms === 0 ? null : true;
  else if (total !== null && total >= 1 && mainLevelBedrooms === total) primaryBedroomOnMain = true;
  else if (mainLevelBedrooms === 0) primaryBedroomOnMain = false;
  return { mainLevelBedrooms, primaryBedroomOnMain };
}

export function mapResoProperty(p: ResoProperty): MapResult {
  const listingKey = str(p.ListingKey);
  if (!listingKey) return { ok: false, listingKey: null, reason: "missing_key" };

  // IDX: sellers can opt out of internet display entirely.
  if (bool(p.InternetEntireListingDisplayYN) === false) {
    return { ok: false, listingKey, reason: "not_displayable" };
  }

  const status = mapStatus(p.StandardStatus);
  if (!status) return { ok: false, listingKey, reason: "unsupported_status" };

  const types = mapPropertyType(p.PropertyType, p.PropertySubType);
  if (!types) return { ok: false, listingKey, reason: "unsupported_property_type" };

  const commercialLease = types.transactionType === "rent" && types.propertyType === "commercial";
  const listPrice = (commercialLease ? monthlyLeaseAmount(p) : null) ?? int(p.ListPrice);
  // A commercial lease priced under $100 is a per-square-foot rate ("14" for
  // $14/sf/yr). Without the rentable area and basis it can't become a monthly
  // rent, and showing "$14/mo" would mislead, so treat it as unpriced.
  if (listPrice === null || listPrice <= 0 || (commercialLease && listPrice < 100))
    return { ok: false, listingKey, reason: "missing_price" };

  const street = formatStreet(p);
  const city = str(p.City);
  const state = str(p.StateOrProvince);
  const postalCode = str(p.PostalCode)?.slice(0, 5) ?? null;
  if (!street || !city || !state || !postalCode) {
    return { ok: false, listingKey, reason: "missing_address" };
  }

  const bathroomsFull = int(p.BathroomsFull);
  const bathroomsHalf = int(p.BathroomsHalf);
  const bathrooms =
    bathroomsFull !== null || bathroomsHalf !== null
      ? (bathroomsFull ?? 0) + 0.5 * (bathroomsHalf ?? 0)
      : num(p.BathroomsTotalInteger);

  const lotSqft = num(p.LotSizeSquareFeet) ?? (num(p.LotSizeAcres) ?? 0) * 43_560;
  const levels = list(p.Levels).map((l) => l.toLowerCase());
  const stories = int(p.Stories) ?? int(p.StoriesTotal);
  const views = list(p.View);
  const coords = coordinates(p);
  const subdivision = str(p.SubdivisionName);
  const lotDimensions = str(p.LotSizeDimensions);
  const hoaFee = int(p.AssociationFee);
  const assessedValue = int(p.TaxAssessedValue);

  const listing: NormalizedListing = {
    listingKey,
    mlsNumber: str(p.ListingId),
    status,
    propertyType: types.propertyType,
    transactionType: types.transactionType,
    propertySubType: str(p.PropertySubType),

    listPrice,
    originalListPrice: int(p.OriginalListPrice),
    closePrice: int(p.ClosePrice),
    // Never ListingContractDate or OnMarketDate: Georgia MLS forbids showing
    // them (Exhibit C), and the list date is shown and dated in the history.
    listDate: date(p.OriginalEntryTimestamp),
    closeDate: date(p.CloseDate),

    bedrooms: int(p.BedroomsTotal),
    bathroomsFull,
    bathroomsHalf,
    bathrooms,
    livingAreaSqft: int(p.LivingArea),
    lotSizeSqft: lotSqft > 0 ? Math.round(lotSqft) : null,
    yearBuilt: int(p.YearBuilt),
    stories,
    garageSpaces: int(p.GarageSpaces),
    fireplacesTotal: int(p.FireplacesTotal),
    parkingTotal: int(p.ParkingTotal),
    ...mainLevelBedroomFacts(p),
    seniorCommunity: bool(p.SeniorCommunityYN),
    lotSizeDimensions: lotDimensions && !isNullLike(lotDimensions) ? lotDimensions : null,
    zoning: str(p.Zoning),

    associationYN: bool(p.AssociationYN) ?? (hoaFee !== null && hoaFee > 0 ? true : null),
    hoaFee: bool(p.AssociationYN) === false ? null : hoaFee,
    hoaFrequency: hoaFrequency(p.AssociationFeeFrequency),
    taxAnnualAmount: int(p.TaxAnnualAmount),
    taxYear: taxYear(p.TaxYear),
    taxAssessedValue: assessedValue !== null && assessedValue > 0 ? assessedValue : null,

    addressLine1: titleCaseIfShouting(street),
    unitNumber: str(p.UnitNumber),
    city: titleCaseIfShouting(city),
    state: state.toUpperCase(),
    postalCode,
    county: str(p.CountyOrParish),
    // Georgia MLS sends "None" (or "none") for no subdivision.
    neighborhood: subdivision && !isNullLike(subdivision) ? titleCaseIfShouting(subdivision) : null,
    waterBodyName: str(p.WaterBodyName) ? titleCaseIfShouting(str(p.WaterBodyName)!) : null,
    latitude: coords?.[0] ?? null,
    longitude: coords?.[1] ?? null,
    hideAddress: bool(p.InternetAddressDisplayYN) === false,

    headline: null,
    description: str(p.PublicRemarks),
    // Guarded: no excluded field (showings, lockbox, compensation…) ever becomes a feature list.
    features: withoutExcludedFields({
      interior: list(p.InteriorFeatures),
      exterior: list(p.ExteriorFeatures),
      appliances: list(p.Appliances),
      heating: list(p.Heating),
      cooling: list(p.Cooling),
      parking: list(p.ParkingFeatures),
      flooring: list(p.Flooring),
      community: list(p.CommunityFeatures),
      utilities: list(p.Utilities),
      view: views,
      construction: list(p.ConstructionMaterials),
      lot: list(p.LotFeatures),
      ...nonEmptyLists({
        sewer: p.Sewer,
        water: p.WaterSource,
        roof: p.Roof,
        foundation: p.FoundationDetails,
        style: p.ArchitecturalStyle,
        fireplace: p.FireplaceFeatures,
        basement: p.Basement,
        patioPorch: p.PatioAndPorchFeatures,
        fencing: p.Fencing,
        laundry: p.LaundryFeatures,
        accessibility: p.AccessibilityFeatures,
        greenEnergy: p.GreenEnergyEfficient,
        otherStructures: p.OtherStructures,
        associationFeeIncludes: p.AssociationFeeIncludes,
        associationAmenities: p.AssociationAmenities,
        roadFrontage: p.RoadFrontageType,
        roadSurface: p.RoadSurfaceType,
        windows: p.WindowFeatures,
        security: p.SecurityFeatures,
        waterfront: p.WaterfrontFeatures,
        electric: p.Electric,
        levels: p.Levels,
        condition: p.PropertyCondition,
        specialConditions: p.SpecialListingConditions,
        listingTerms: p.ListingTerms,
        currentUse: p.CurrentUse,
        possibleUse: p.PossibleUse,
        horse: p.HorseAmenities,
        spa: p.SpaFeatures,
      }),
    }),
    schools: {
      district: str(p.HighSchoolDistrict) ?? undefined,
      elementary: str(p.ElementarySchool) ?? undefined,
      middle: str(p.MiddleOrJuniorSchool) ?? undefined,
      high: str(p.HighSchool) ?? undefined,
    },

    hasPool: bool(p.PoolPrivateYN) ?? list(p.PoolFeatures).length > 0,
    isWaterfront: bool(p.WaterfrontYN) ?? false,
    hasView: bool(p.ViewYN) ?? views.length > 0,
    hasBasement: list(p.Basement).length > 0,
    isNewConstruction: bool(p.NewConstructionYN) ?? false,
    isSingleStory: stories === 1 || (levels.length > 0 && levels.every((l) => l === "one")),

    virtualTourUrl: str(p.VirtualTourURLUnbranded),
    videoUrl: null,

    listAgentMlsId: str(p.ListAgentMlsId),
    listAgentName: str(p.ListAgentFullName),
    listAgentPhone: str(p.ListAgentDirectPhone) ?? str(p.ListAgentPreferredPhone),
    listAgentEmail: str(p.ListAgentEmail),
    listOfficeName: str(p.ListOfficeName),
    listOfficeMlsId: str(p.ListOfficeMlsId),
    ...attribution(p),
    ...compensation(p),

    sourceModifiedAt: timestamp(p.ModificationTimestamp),
    statusChangedAt: timestamp(p.StatusChangeTimestamp),

    media: mapMedia(p.Media),
    openHouses: mapOpenHouses(p.OpenHouse),
  };

  return { ok: true, listing };
}

/** Some MLSs send addresses in ALL CAPS. */
function titleCaseIfShouting(s: string): string {
  return s === s.toUpperCase() && /[A-Z]{3,}/.test(s) ? titleCase(s) : s;
}
