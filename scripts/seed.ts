/**
 * Seeds a development database with a realistic sample market: Adams Realty's
 * real office and broker, a few sample agents, open houses, price history,
 * leads and demo logins, and about 431 FICTIONAL listings:
 * - 180 in Northeast Georgia, the towns and lakes the firm serves: Adams
 *   Realty's own listings plus a demo MLS feed. Adams listings are only here.
 * - 226 statewide (Atlanta and its suburbs, the regional cities, the
 *   mountains and south Georgia), all from other (fictional) brokerages in
 *   the demo feed, generated after the Northeast Georgia block from their own
 *   PRNG seed so that block never changes.
 * - 12 on Lake Sinclair and Lake Oconee (STATEWIDE_LAKES), generated after
 *   those, so adding them moved none of the 226.
 * - 3 lake homes shaped like the real feed (LAKE_FIXTURES): the lake only in
 *   WaterBodyName, never in `neighborhood`, so lake searches stay tested.
 * - 6 Decatur listings for the Georgia MLS display rules (IDX_FIXTURES).
 * - 4 Carnesville listings the firm entered by hand, one in each status the
 *   public never sees (FIRM_HIDDEN_FIXTURES).
 *
 *   npm run db:seed
 *
 * Only the office and Andrea Anderegg's profile are real. Every listing, every
 * other agent and every other brokerage is a sample for demonstration, and
 * both demo data sources carry a disclaimer saying so (shown in the footer).
 *
 * Listings are written through the same `upsertListing` pipeline the MLS
 * sync uses, so seeded data exercises the production code path.
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  agents,
  dataSources,
  inquiries,
  listingEvents,
  offices,
  savedListings,
  savedSearches,
  users,
} from "@/db/schema";
import { upsertListing, type PersistSource } from "@/lib/listings/persist";
import { refreshPlaces } from "@/lib/listings/places";
import {
  FEATURED_MIN,
  getFeaturedListings,
  getLocationSuggestions,
  getPlacesIndex,
  getTopCities,
} from "@/lib/listings/queries";
import { slugify } from "@/lib/listings/slug";
import { DEFAULT_CRITERIA, type SearchCriteria } from "@/lib/search/params";
import { searchListings } from "@/lib/search/service";
import type { NormalizedListing, NormalizedMedia } from "@/lib/mls/types";
import {
  AGENTS,
  APPLIANCES,
  AREAS,
  COMMERCIAL_DETAILS,
  COMMERCIAL_PHOTOS,
  COMMERCIAL_SUFFIXES,
  COMMUNITY,
  CONDO_EXTERIORS,
  CONDO_STREETS,
  COUNTY_DISTRICTS,
  EXTERIOR_FEATURES,
  EXTERIORS,
  FARM_DETAILS,
  FIRM_HIDDEN_FIXTURES,
  FLOORING,
  HIGHLIGHTS,
  INTERIOR_FEATURES,
  INTERIORS,
  LAKE_HIGHLIGHTS,
  IDX_FIXTURES,
  LAKE_FIXTURES,
  LAKE_LOT_DETAILS,
  LAKE_PHOTOS,
  LAKE_SUFFIXES,
  LAND_DETAILS,
  LAND_PHOTOS,
  OPENERS,
  OTHER_BROKERAGES,
  RURAL_SUFFIXES,
  STATEWIDE_AREAS,
  STATEWIDE_LAKES,
  STREETS,
  STYLES,
  SUFFIXES,
  TIMBER_DETAILS,
  type SeedArea,
  type SeedPropertyType,
} from "./seed-data";
import SITES from "./seed-sites.json";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("Refusing to seed a production database. Pass --force if you really mean it.");
  process.exit(1);
}

/** Adams Realty's Georgia MLS office ID (matches `site.mls.officeId`). */
const OFFICE_MLS_ID = "ADAM01";
const DEMO_DISCLAIMER =
  "Demo data: every listing on this site, and every agent profile except Andrea Anderegg's, is a fictional sample for demonstration only. In production this notice is replaced by the IDX disclaimer Georgia MLS requires.";

// Deterministic PRNG so every developer gets the same data.
let state = 20260925;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
/** Skewed toward `min`, like real inventory: most tracts and homes are modest, a few are huge. */
const skewed = ([min, max]: [number, number], power = 1.8) => min + (max - min) * rand() ** power;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
function sample<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length)
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}
function weighted<T extends string>(weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights) as [T, number][];
  let r = rand() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) {
    if ((r -= w) <= 0) return k;
  }
  return entries[0][0];
}

const NOW = new Date();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const ACRE = 43_560;

function roundPrice(p: number): number {
  const step = p < 500_000 ? 1_000 : p < 2_000_000 ? 5_000 : 25_000;
  return Math.round(p / step) * step;
}

function nextWeekend(offsetWeeks = 0): Date {
  const d = new Date(NOW);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((6 - day + 7) % 7 || 7) + offsetWeeks * 7);
  return d;
}

// --- Coordinates -------------------------------------------------------------

/**
 * core: near downtown · town: inside city limits · rural: outside town ·
 * waterfront: mainland within 100 m of the lake · near: lake area, not on it.
 */
type SiteKind = "core" | "town" | "rural" | "waterfront" | "near";
type Site = { lat: number; lng: number; county: string; city?: string; zip?: string };

const siteRows = SITES.areas as Record<string, Partial<Record<SiteKind, (string | number)[][]>>>;
const pools = new Map<string, Site[]>();
/** If a pool runs dry, a neighboring kind is still a valid spot for the same area. */
const FALLBACK: Record<SiteKind, SiteKind[]> = {
  core: ["town"],
  town: ["core", "rural"],
  rural: ["town"],
  waterfront: [],
  near: [],
};

/** Hands out each validated site at most once, so no two listings share a pin. */
function takeSite(area: SeedArea, kind: SiteKind): Site {
  for (const k of [kind, ...FALLBACK[kind]]) {
    const key = `${area.slug}.${k}`;
    if (!pools.has(key)) {
      const rows = siteRows[area.slug]?.[k] ?? [];
      const sites = rows.map(([lat, lng, county, city, zip]) => ({
        lat: Number(lat),
        lng: Number(lng),
        county: String(county),
        city: city === undefined ? undefined : String(city),
        zip: zip === undefined ? undefined : String(zip),
      }));
      pools.set(key, sample(sites, sites.length));
    }
    const site = pools.get(key)!.pop();
    if (site) return site;
  }
  throw new Error(`seed-sites.json ran out of "${kind}" sites for ${area.slug}; add more.`);
}

// --- Listing generation --------------------------------------------------------

function buildMedia(opts: {
  type: SeedPropertyType;
  onWater: boolean;
  lakeView: boolean;
}): NormalizedMedia[] {
  const { type, onWater, lakeView } = opts;
  let photos: Array<{ url: string; caption: string }>;
  if (type === "land") {
    photos = [...(onWater ? sample(LAKE_PHOTOS, 1) : []), ...sample(LAND_PHOTOS, intBetween(2, 3))];
  } else if (type === "commercial") {
    photos = [COMMERCIAL_PHOTOS[0], ...sample(COMMERCIAL_PHOTOS.slice(1), intBetween(2, 4))];
  } else {
    const front = {
      url: pick(type === "condo" ? CONDO_EXTERIORS : EXTERIORS),
      caption: "Exterior",
    };
    const outdoors = [
      ...(onWater || lakeView ? sample(LAKE_PHOTOS, 1) : []),
      ...(type === "farm_ranch" ? sample(LAND_PHOTOS, 2) : []),
    ];
    const rooms = sample(INTERIORS, intBetween(type === "farm_ranch" ? 4 : 6, 12));
    photos = [front, ...outdoors, ...rooms];
  }
  return photos.map((m, i) => ({
    url: m.url,
    caption: m.caption,
    kind: "photo" as const,
    sourceKey: null,
    width: 1600,
    height: 1067,
    sortOrder: i,
  }));
}

type Generated = { listing: NormalizedListing; area: SeedArea; priceDropFrom?: number };

/**
 * `n` areas in proportion to `weightOf` (largest remainder), shuffled. Quotas
 * rather than weighted draws, so every town reliably gets enough listings for
 * its guide's stats.
 */
function allocateAreas(
  n: number,
  weightOf: (a: SeedArea) => number,
  areas: SeedArea[] = AREAS,
): SeedArea[] {
  const total = areas.reduce((s, a) => s + weightOf(a), 0);
  const shares = areas.map((a) => {
    const exact = (n * weightOf(a)) / total;
    return { area: a, count: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = n - shares.reduce((s, x) => s + x.count, 0);
  for (const x of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (left-- <= 0) break;
    x.count += 1;
  }
  const list = shares.flatMap((x) => Array.from({ length: x.count }, () => x.area));
  return sample(list, list.length);
}

function siteKindFor(area: SeedArea, type: SeedPropertyType, onWater: boolean): SiteKind {
  if (area.kind === "lake") return onWater ? "waterfront" : "near";
  const kind = townSiteKindFor(type);
  // A city with no countryside of its own puts its land in town.
  return area.urban && kind === "rural" ? "town" : kind;
}

function townSiteKindFor(type: SeedPropertyType): SiteKind {
  switch (type) {
    case "commercial":
      return chance(0.65) ? "core" : "town";
    case "condo":
    case "townhouse":
    case "multi_family":
      return chance(0.4) ? "core" : "town";
    case "land":
      return chance(0.15) ? "town" : "rural";
    case "farm_ranch":
    case "manufactured":
      return "rural";
    default:
      return chance(0.72) ? "town" : "rural";
  }
}

const COMMERCIAL_TYPES = {
  core: ["Retail", "Office", "Mixed Use", "Restaurant"],
  town: ["Office", "Retail", "Warehouse", "Industrial"],
};

type GenerateOptions = {
  area: SeedArea;
  type?: SeedPropertyType;
  onWater?: boolean;
  /** MLS number; by default a random one (Northeast Georgia block). */
  mlsNumber?: string;
  /** Forces status "active" when it returns true (after the status roll is drawn). */
  activeIf?: (l: { county: string; mode: "sale" | "rent" }) => boolean;
};

function generateListing(i: number, opts: GenerateOptions): Generated {
  const { area } = opts;
  const type = opts.type ?? weighted(area.mix);
  const isLake = area.kind === "lake";
  const onWater =
    isLake &&
    (type === "single_family" || type === "land") &&
    (opts.onWater ?? chance(area.waterfrontChance ?? 0));
  const kind = siteKindFor(area, type, onWater);
  const site = takeSite(area, kind);
  const rural = kind === "rural";

  const isLand = type === "land";
  const isCommercial = type === "commercial";
  const isFarm = type === "farm_ranch";
  const isCondo = type === "condo";
  const hasHome = !isLand && !isCommercial;

  // Acreage for anything sold with land; in-town and lake lots are in square feet.
  const acres = isFarm
    ? skewed([Math.max(10, area.acres[0]), Math.max(20, area.acres[1])], 1.6)
    : isLand
      ? onWater
        ? skewed(area.acres)
        : isLake
          ? skewed([1, 10])
          : kind === "town"
            ? between(0.3, 2)
            : skewed(area.acres, 2.2)
      : rural
        ? skewed([1, type === "manufactured" ? 8 : 15], 2.5)
        : null;
  const lot = isCondo
    ? null
    : acres !== null
      ? Math.round((acres * ACRE) / 10) * 10
      : type === "townhouse"
        ? intBetween(1800, 4500)
        : isCommercial
          ? intBetween(kind === "core" ? 5_000 : 20_000, kind === "core" ? 25_000 : 90_000)
          : isLake && !onWater
            ? intBetween(15_000, 60_000)
            : Math.round(between(...area.lot) / 10) * 10;

  const sqft = isLand
    ? null
    : isCommercial
      ? Math.round(skewed([1200, 12000], 2.2) / 10) * 10
      : type === "manufactured"
        ? Math.round(skewed([900, 2200]) / 10) * 10
        : isCondo
          ? Math.round(skewed([850, 2200]) / 10) * 10
          : type === "townhouse"
            ? Math.round(skewed([1200, 2400]) / 10) * 10
            : Math.round(skewed(area.sqft) / 10) * 10;
  const beds = !hasHome
    ? null
    : Math.max(
        isCondo ? 1 : 2,
        Math.min(isCondo ? 3 : 6, Math.round((sqft ?? 0) / 650 + between(-0.6, 0.8))),
      );
  const bathsFull = !hasHome
    ? null
    : Math.max(1, Math.min(5, Math.round((beds ?? 1) * 0.75 + between(-0.3, 0.6))));
  const bathsHalf = !hasHome ? null : chance(0.4) ? 1 : 0;
  const year = isLand
    ? null
    : type === "manufactured"
      ? intBetween(1988, 2024)
      : isCommercial
        ? intBetween(1925, 2020)
        : isFarm
          ? intBetween(1900, 2022)
          : intBetween(...area.years);
  const newBuild = !!year && year > 2015 ? 1.06 : 1;
  const ppsf = between(...area.ppsf) * newBuild * (isLake && !onWater ? 0.6 : 1);
  const perAcre = between(...area.perAcre);

  const salePrice = roundPrice(
    isLand
      ? onWater
        ? acres! * perAcre
        : isLake
          ? acres! * perAcre * 0.2 + between(15_000, 35_000)
          : acres! * perAcre + (acres! < 5 ? between(10_000, 25_000) : 0)
      : isFarm
        ? sqft! * ppsf * 0.9 + acres! * perAcre * 0.95 + between(40_000, 120_000)
        : isCommercial
          ? sqft! * ppsf * between(0.45, 0.85) + ((lot ?? 0) / ACRE) * perAcre * 0.5
          : type === "manufactured"
            ? sqft! * ppsf * 0.55 + (acres ?? 0.5) * perAcre * 0.6
            : sqft! * ppsf + (acres ? Math.max(0, acres - 1) * perAcre * 0.5 : 0),
  );

  // Rentals: some houses, more townhomes and condos, and commercial leases.
  // Luxury homes, land and farms rarely hit the rental market.
  const rentChance = isCommercial
    ? 0.3
    : isLand || isFarm || salePrice > 900_000
      ? 0
      : isCondo || type === "multi_family"
        ? 0.3
        : type === "townhouse"
          ? 0.2
          : isLake
            ? 0.05
            : 0.1;
  const mode = chance(rentChance) ? "rent" : "sale";
  const listPrice =
    mode === "sale"
      ? salePrice
      : isCommercial
        ? Math.round(((sqft ?? 2000) * between(8, 18)) / 12 / 25) * 25
        : Math.round((salePrice * between(0.0055, 0.0075)) / 25) * 25;

  const statusRoll = rand();
  const status: NormalizedListing["status"] = opts.activeIf?.({ county: site.county, mode })
    ? "active"
    : mode === "rent"
      ? statusRoll < 0.9
        ? "active"
        : "pending"
      : statusRoll < 0.66
        ? "active"
        : statusRoll < 0.71
          ? "coming_soon"
          : statusRoll < 0.8
            ? "active_under_contract"
            : statusRoll < 0.86
              ? "pending"
              : "closed";

  const maxDom = isLand || isFarm ? 240 : isCommercial ? 180 : 95;
  const dom =
    status === "coming_soon"
      ? -intBetween(2, 10)
      : status === "closed"
        ? intBetween(30, 200)
        : intBetween(1, maxDom);
  const listDate = daysAgo(dom);
  const priceDrop = mode === "sale" && status === "active" && dom > 20 && chance(0.35);
  const originalPrice = priceDrop ? roundPrice(listPrice * between(1.02, 1.07)) : listPrice;
  const closeDate = status === "closed" ? daysAgo(intBetween(3, Math.max(4, dom - 20))) : null;
  const closePrice = status === "closed" ? roundPrice(listPrice * between(0.95, 1.03)) : null;

  const stories = !hasHome
    ? isCommercial
      ? intBetween(1, 2)
      : null
    : isCondo
      ? 1
      : chance(0.5)
        ? 1
        : 2;
  const garage = hasHome && !isCondo ? (chance(0.8) ? intBetween(1, 3) : null) : null;
  const pool = hasHome && !isCondo && chance(area.poolChance ?? 0.05);
  const lakeView = isLake && hasHome && !onWater && chance(0.35);
  const view =
    onWater ||
    lakeView ||
    (area.mountainViewChance !== undefined && chance(area.mountainViewChance)) ||
    chance(0.04);
  const basement = hasHome && !isCondo && chance(area.basementChance ?? 0.12);
  const newConstruction = hasHome && !!year && year >= NOW.getUTCFullYear() - 1 && mode === "sale";
  const hoa = isCondo
    ? intBetween(250, 600)
    : type === "townhouse"
      ? intBetween(125, 300)
      : type === "single_family" && !rural && chance(onWater ? 0.2 : (area.hoaChance ?? 0.15))
        ? intBetween(25, 90)
        : null;

  const inPlace = isLake ? `${onWater ? "on" : "near"} ${area.name}` : `in ${area.name}`;
  const city = site.city ?? area.city;
  const zip = site.zip ?? area.zip;
  const subtype = isCommercial ? pick(COMMERCIAL_TYPES[kind === "core" ? "core" : "town"]) : null;

  const street = isCondo
    ? pick(CONDO_STREETS)
    : `${pick(STREETS)} ${pick(
        isCommercial
          ? COMMERCIAL_SUFFIXES
          : onWater || (isLake && chance(0.5))
            ? LAKE_SUFFIXES
            : rural
              ? RURAL_SUFFIXES
              : SUFFIXES,
      )}`;
  const streetNumber = isCondo
    ? intBetween(100, 900)
    : rural || isLake
      ? intBetween(100, 9999)
      : intBetween(100, 2999);
  const unit = isCondo ? String(intBetween(1, 3) * 100 + intBetween(1, 24)) : null;

  // Georgia effective property-tax rates run roughly 0.8–1.2% of value;
  // farm and timber land under conservation use pays far less.
  const taxes =
    mode === "sale"
      ? Math.round(salePrice * (isLand || isFarm ? between(0.003, 0.007) : between(0.008, 0.012)))
      : null;
  const district = isCommercial
    ? undefined
    : !rural && !isLake && area.district
      ? area.district
      : COUNTY_DISTRICTS[site.county];

  const listing: NormalizedListing = {
    listingKey: `DEMO-${String(i).padStart(5, "0")}`,
    mlsNumber: opts.mlsNumber ?? String(10_300_000 + intBetween(0, 199_999)),
    status,
    transactionType: mode,
    propertyType: type,
    propertySubType:
      subtype ??
      {
        single_family: "Single Family Residence",
        condo: "Condominium",
        townhouse: "Townhouse",
        multi_family: "Duplex",
        manufactured: "Manufactured Home",
        land: kind === "rural" ? "Unimproved Land" : "Residential Lot",
        farm_ranch: "Farm",
        commercial: "Commercial",
      }[type],
    listPrice,
    originalListPrice: originalPrice,
    closePrice,
    listDate: isoDate(listDate),
    closeDate: closeDate ? isoDate(closeDate) : null,
    bedrooms: beds,
    bathroomsFull: bathsFull,
    bathroomsHalf: bathsHalf,
    bathrooms: bathsFull === null ? null : bathsFull + 0.5 * (bathsHalf ?? 0),
    livingAreaSqft: sqft,
    lotSizeSqft: lot,
    yearBuilt: year,
    stories,
    garageSpaces: garage,
    hoaFee: hoa,
    hoaFrequency: hoa ? "monthly" : null,
    taxAnnualAmount: taxes,
    taxYear: taxes ? NOW.getUTCFullYear() - 1 : null,
    addressLine1: `${streetNumber} ${street}`,
    unitNumber: unit,
    city,
    state: "GA",
    postalCode: zip,
    county: site.county,
    // Lakes are the "neighborhood" MLS feeds use; small-town and rural
    // listings usually have no subdivision, and guides match them by city.
    neighborhood: isLake || area.kind === "neighborhood" ? area.name : null,
    // RESO WaterBodyName: the lake a waterfront property is on.
    waterBodyName: onWater ? area.name : null,
    latitude: site.lat,
    longitude: site.lng,
    hideAddress: false,
    headline: null,
    description: describe({
      area,
      type,
      inPlace,
      beds: beds ?? 0,
      acres,
      lot: lot ?? 0,
      sqft: sqft ?? 0,
      subtype,
      onWater,
      basement,
    }),
    features: isLand
      ? {
          lot: onWater
            ? ["Waterfront", "Lake Frontage", ...sample(["Wooded", "Sloped", "Views"], 2)]
            : sample(["Pasture", "Hardwoods", "Pines", "Level", "Rolling", "Road Frontage"], 3),
          utilities:
            kind === "town"
              ? ["Electricity Available", "Public Water Available"]
              : ["Electricity Available", "Well Needed", "Septic Needed"],
        }
      : isCommercial
        ? {
            interior: sample(["Open Floorplan", "Private Offices", "Restrooms", "Break Room"], 2),
            parking: [`Parking Lot (${intBetween(6, 60)} spaces)`],
            utilities: ["Public Water", "Public Sewer", "Natural Gas Available"],
            construction: sample(["Brick", "Block", "Metal", "Wood Siding"], 2),
            lot: sample(["Corner Lot", "Road Frontage", "Level"], 2),
          }
        : {
            interior: sample(INTERIOR_FEATURES, intBetween(4, 7)),
            exterior: [
              ...(onWater ? ["Boat Dock"] : []),
              ...sample(EXTERIOR_FEATURES, intBetween(2, 4)),
            ],
            appliances: sample(APPLIANCES, intBetween(3, 6)),
            heating: [pick(["Central", "Heat Pump", "Propane"])],
            cooling: ["Central Air"],
            parking: garage
              ? [`Garage (${garage} car)`, pick(["Attached", "Detached", "Carport"])]
              : ["Driveway"],
            flooring: sample(FLOORING, 2),
            community: isCondo
              ? ["Pool", "Fitness Center", "Clubhouse"]
              : hoa
                ? sample(COMMUNITY, intBetween(1, 3))
                : [],
            view: view
              ? [isLake ? "Lake" : area.mountainViewChance ? "Mountain(s)" : "Trees/Woods"]
              : [],
            lot: isFarm
              ? ["Pasture", "Barn", "Fenced"]
              : acres
                ? sample(["Wooded", "Level", "Private"], 2)
                : [],
            utilities: rural || isFarm ? ["Well", "Septic Tank"] : ["Public Water", "Public Sewer"],
            construction: isCondo
              ? ["Brick", "HardiPlank Type"]
              : sample(["Brick", "Stone", "HardiPlank Type", "Vinyl Siding", "Wood Siding"], 2),
          },
    schools: district
      ? {
          district,
          // Generic sample names — real listings carry the MLS's school assignments.
          elementary: `${pick(["Oak Grove", "Brookside", "Heritage", "Willow Creek", "Parkview", "Magnolia"])} Elementary`,
          middle: `${pick(["Lakeside", "Summit", "Riverside", "Crestwood", "Pinecrest"])} Middle`,
          high: `${pick(["North Ridge", "Central", "Highland", "Valley View", "Westfield"])} High`,
        }
      : {},
    hasPool: pool,
    isWaterfront: onWater,
    hasView: view,
    hasBasement: basement,
    isNewConstruction: newConstruction,
    isSingleStory: stories === 1 && hasHome && !isCondo,
    virtualTourUrl: hasHome && chance(0.2) ? "https://my.matterport.com/show/?m=demo" : null,
    videoUrl: null,
    listAgentMlsId: null,
    listAgentName: `${pick(["Chris", "Jordan", "Taylor", "Morgan", "Alex", "Casey", "Jamie", "Riley"])} ${pick(["Nguyen", "Smith", "Garcia", "Johnson", "Patel", "Brown", "Lee", "Wilson"])}`,
    // 555-0100…0199 are the numbers set aside for fiction; one draw, as before.
    listAgentPhone: `(${pick(area.areaCodes ?? ["706", "762", "470"])}) 555-01${String(intBetween(0, 99)).padStart(2, "0")}`,
    listAgentEmail: null,
    listOfficeName: pick(OTHER_BROKERAGES),
    listOfficeMlsId: null,
    sourceModifiedAt: daysAgo(Math.max(0, Math.min(dom, intBetween(0, 10)))),
    statusChangedAt:
      status === "active" || status === "coming_soon"
        ? listDate
        : daysAgo(intBetween(1, Math.max(2, dom))),
    media: buildMedia({ type, onWater, lakeView }),
    openHouses:
      status === "active" && mode === "sale" && hasHome && !isFarm && chance(0.25)
        ? [0, ...(chance(0.4) ? [1] : [])].map((dayOffset) => {
            const d = nextWeekend();
            d.setUTCDate(d.getUTCDate() + dayOffset);
            d.setUTCHours(17 + intBetween(0, 1), 0, 0, 0); // 1–2pm Eastern (EDT)
            return {
              sourceKey: null,
              type: "in_person" as const,
              startsAt: d,
              endsAt: new Date(d.getTime() + intBetween(2, 3) * 3_600_000),
              remarks: chance(0.5) ? "Refreshments served. No appointment needed." : null,
            };
          })
        : [],
  };
  return { listing, area, priceDropFrom: priceDrop ? originalPrice : undefined };
}

function describe(c: {
  area: SeedArea;
  type: SeedPropertyType;
  inPlace: string;
  beds: number;
  acres: number | null;
  lot: number;
  sqft: number;
  subtype: string | null;
  onWater: boolean;
  basement: boolean;
}): string {
  const opener = pick(OPENERS[c.type])
    .replace("{style}", pick(STYLES))
    .replace("{in}", c.inPlace)
    .replace("{lotAdj}", c.lot > 43_560 ? "sprawling" : c.lot > 15_000 ? "generous" : "sunny")
    .replace(
      "{view}",
      c.onWater || c.area.kind === "lake"
        ? "lake views"
        : c.area.urban
          ? "city views"
          : "wooded views",
    )
    .replace("{beds}", String(c.beds))
    .replace("{acres}", (c.acres ?? c.lot / 43_560).toFixed(c.acres && c.acres >= 10 ? 0 : 1))
    .replace("{sqft}", c.sqft.toLocaleString("en-US"))
    .replace("{subtype}", (c.subtype ?? "commercial").toLowerCase());
  const homeHighlights = HIGHLIGHTS.filter((h) => c.basement || !h.includes("basement"));
  const body =
    c.type === "land"
      ? c.onWater
        ? sample(LAKE_LOT_DETAILS, 2)
        : [...sample(LAND_DETAILS, 2), ...((c.acres ?? 0) >= 25 ? sample(TIMBER_DETAILS, 1) : [])]
      : c.type === "commercial"
        ? sample(COMMERCIAL_DETAILS, 2)
        : c.type === "farm_ranch"
          ? [...sample(FARM_DETAILS, 1), ...sample(homeHighlights, 1)]
          : [
              ...(c.onWater ? sample(LAKE_HIGHLIGHTS, 1) : []),
              ...sample(homeHighlights, c.type === "condo" ? 2 : 3),
            ];
  const closer =
    c.type === "commercial"
      ? `Located ${c.inPlace}, ${c.area.vibe}.`
      : `All of it ${c.inPlace}, ${c.area.vibe}.`;
  return [opener, ...body, closer].join(" ");
}

async function createLogin(input: {
  name: string;
  email: string;
  role: "user" | "agent" | "admin";
  password: string;
}) {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, name: input.name, email: input.email, emailVerified: true, role: input.role });
  await db.insert(accounts).values({
    id: crypto.randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(input.password),
  });
  return id;
}

async function main() {
  const password = process.env.SEED_PASSWORD ?? "adams-demo-2026";
  console.info("Resetting tables…");
  await db.execute(sql`
    TRUNCATE audit_logs, inquiries, saved_searches, saved_listings, listing_events, open_houses,
      listing_media, listings, sync_runs, data_sources, agents, offices, verifications, sessions,
      accounts, users RESTART IDENTITY CASCADE
  `);

  // REAL: Adams Realty's office, as published (Georgia MLS office ADAM01).
  const [office] = await db
    .insert(offices)
    .values({
      slug: "main-office",
      name: "Adams Realty, Inc.",
      phone: "(706) 246-0053",
      // PLACEHOLDER: the firm's public inbox isn't known yet (see src/config/site.ts).
      email: "contracts.adamsrealty@gmail.com",
      addressLine1: "69 Mill Street",
      city: "Royston",
      state: "GA",
      postalCode: "30662",
      mlsOfficeId: OFFICE_MLS_ID,
    })
    .returning();

  console.info("Creating logins…");
  // Andrea Anderegg's login keeps the admin@ address that tests and docs use.
  const adminId = await createLogin({
    name: AGENTS[0].name,
    email: "admin@adamsrealty.example",
    role: "admin",
    password,
  });
  const agentUserIds = [
    adminId,
    await createLogin({ name: AGENTS[1].name, email: AGENTS[1].email, role: "agent", password }),
    await createLogin({ name: AGENTS[2].name, email: AGENTS[2].email, role: "agent", password }),
  ];
  const buyerId = await createLogin({
    name: "Jordan Buyer",
    email: "buyer@example.com",
    role: "user",
    password,
  });

  const agentRows = await db
    .insert(agents)
    .values(
      AGENTS.map((a, i) => ({
        userId: agentUserIds[i] ?? null,
        officeId: office.id,
        slug: slugify(a.name),
        name: a.name,
        title: a.title,
        email: a.email,
        phone: a.phone,
        bio: a.bio,
        photoUrl: a.photoUrl,
        // Never invent license numbers: unknown for Andrea, meaningless for samples.
        licenseNumber: null,
        mlsAgentId: a.mlsAgentId,
        specialties: a.specialties,
        languages: a.languages,
        serviceAreas: a.areas,
        yearsExperience: a.years,
        sortOrder: i,
      })),
    )
    .returning();
  const broker = agentRows[0];
  const agentIdsByMlsId = new Map(agentRows.map((a) => [a.mlsAgentId!, a.id]));

  const [manualSource, demoSource] = await db
    .insert(dataSources)
    .values([
      {
        slug: "adams",
        name: "Adams Realty listings",
        kind: "manual" as const,
        config: {},
        disclaimer: DEMO_DISCLAIMER,
      },
      {
        slug: "demo-mls",
        name: "Demo MLS (sample IDX feed)",
        kind: "reso_web_api" as const,
        // Inactive: there's no real endpoint. Point a real source at Georgia MLS's RESO Web API.
        isActive: false,
        config: { resource: "Property", companyOfficeIds: [OFFICE_MLS_ID] },
        disclaimer: DEMO_DISCLAIMER,
      },
    ])
    .returning();

  const toSource = (s: typeof manualSource): PersistSource => ({
    id: s.id,
    slug: s.slug,
    kind: s.kind,
    config: s.config,
  });

  const areaBySlug = new Map(AREAS.map((a) => [a.slug, a]));
  const areaNamed = (name: string) => AREAS.find((a) => a.name === name)!;
  /**
   * Our listings. Each sample agent starts with two in their own areas (one
   * showing off their specialty); the rest follow the office's footprint and
   * mostly go to Andrea, sometimes to a sample agent who works the area.
   */
  const starters: Array<{
    agent: (typeof agentRows)[number];
    area: SeedArea;
    type?: SeedPropertyType;
    onWater?: boolean;
  }> = agentRows.slice(1).flatMap((agent, n) => {
    const specialty = [
      { area: areaBySlug.get("carnesville")!, type: "land" as const },
      { area: areaBySlug.get("braselton")!, type: "single_family" as const },
      { area: areaBySlug.get("lake-hartwell")!, type: "single_family" as const, onWater: true },
      { area: areaBySlug.get("gainesville")!, type: "commercial" as const },
    ][n];
    return [
      { agent, ...specialty },
      { agent, area: areaNamed(agent.serviceAreas[1] ?? agent.serviceAreas[0]) },
    ];
  });
  const total = 180;
  const ourCount = 36;
  const ourAreas = allocateAreas(ourCount - starters.length, (a) => a.ourWeight);
  const feedAreas = allocateAreas(total - ourCount, (a) => a.weight);
  function agentFor(area: SeedArea) {
    const local = agentRows.slice(1).filter((a) => a.serviceAreas.includes(area.name));
    return local.length && chance(0.35) ? pick(local) : broker;
  }

  console.info("Generating listings…");
  const listingIds: string[] = [];
  const ourListings: Array<{ id: string; agentId: string; price: number }> = [];
  const perArea = new Map<string, number>();

  for (let i = 0; i < total; i++) {
    const ours = i < ourCount;
    const starter = starters[i];
    const plan = starter ?? {
      area: ours ? ourAreas[i - starters.length] : feedAreas[i - ourCount],
    };
    const { listing, area, priceDropFrom } = generateListing(i + 1, plan);
    perArea.set(area.slug, (perArea.get(area.slug) ?? 0) + 1);
    const agent = starter?.agent ?? (ours ? agentFor(area) : null);
    // Most of our listings arrive through the MLS feed like they would in
    // production (matched by office and agent MLS IDs); the rest are manual
    // (pocket listings, rentals, coming soon).
    const viaFeed = ours && i % 3 !== 0;
    if (agent) {
      listing.listAgentName = agent.name;
      listing.listAgentEmail = agent.email;
      listing.listAgentPhone = agent.phone;
      listing.listOfficeName = "Adams Realty, Inc.";
      listing.listOfficeMlsId = OFFICE_MLS_ID;
      listing.listAgentMlsId = agent.mlsAgentId;
    }
    const { id } = await db.transaction((tx) =>
      upsertListing(
        tx,
        toSource(ours && !viaFeed ? manualSource : demoSource),
        listing,
        ours && !viaFeed
          ? { listAgentId: agent!.id, isFeatured: listing.status === "active" && i % 3 === 0 }
          : { agentIdsByMlsId, isFeatured: ours && listing.status === "active" && i % 4 === 1 },
      ),
    );
    listingIds.push(id);
    if (agent) ourListings.push({ id, agentId: agent.id, price: listing.listPrice });
    if (priceDropFrom) {
      await db.insert(listingEvents).values({
        listingId: id,
        type: "price_change",
        occurredAt: daysAgo(intBetween(3, 15)),
        price: listing.listPrice,
        previousPrice: priceDropFrom,
      });
    }
  }

  console.info("Adding leads and saved homes…");
  const leadNames = [
    "Avery Thompson",
    "Luis Hernandez",
    "Grace Kim",
    "Noah Williams",
    "Emma Davis",
    "Ethan Brooks",
  ];
  await db.insert(inquiries).values(
    leadNames.map((name, i) => {
      const l = ourListings[i % ourListings.length];
      const type = (["tour", "question", "tour", "offer", "question", "valuation"] as const)[i];
      return {
        type,
        status: (["new", "new", "contacted", "qualified", "new", "new"] as const)[i],
        listingId: type === "valuation" ? null : l.id,
        agentId: type === "valuation" ? null : l.agentId,
        name,
        email: `${name.split(" ")[0].toLowerCase()}@example.com`,
        phone: `(706) 555-01${String(20 + i * 7)}`,
        message:
          type === "tour"
            ? "We'd love to see this one this weekend if possible."
            : type === "offer"
              ? "We're pre-approved and ready to write an offer. What's the seller's timeline?"
              : type === "valuation"
                ? "Thinking about selling our 3/2 in Royston and about 12 acres near Carnesville next spring. What are they worth?"
                : i === 1
                  ? "Is the property on a well or county water? And is there a survey?"
                  : "Are the appliances included, and how old is the roof?",
        tourAt: type === "tour" ? new Date(nextWeekend().setUTCHours(15, 0, 0, 0)) : null, // 11am Eastern
        tourType: type === "tour" ? ("in_person" as const) : null,
        source: type === "valuation" ? "sell" : "listing",
        createdAt: daysAgo(i * 0.7),
      };
    }),
  );

  // A fictional SEO pitch the spam check held back (src/lib/spam.ts), so the Spam tab
  // and its flag have something to show.
  await db.insert(inquiries).values({
    type: "general",
    status: "spam",
    name: "Rank Rocket Team",
    email: "outreach@rankrocket.example",
    message:
      "Hi! Your website isn't showing up in Google's index for key searches. We can improve your search visibility within 30 days. Free audit: https://rankrocket.example/audit",
    source: "contact",
    metadata: { referer: "", userAgent: "", spam: "seo-pitch", routedAgentId: "" },
    createdAt: daysAgo(1.5),
  });

  await db
    .insert(savedListings)
    .values(
      sample(listingIds.slice(ourCount), 5).map((listingId) => ({ userId: buyerId, listingId })),
    );
  await db.insert(savedSearches).values({
    userId: buyerId,
    name: "3+ bd homes in Royston under $400K",
    criteria: { mode: "buy", q: "Royston", beds: 3, maxPrice: 400_000, sort: "newest", page: 1 },
    alertFrequency: "daily",
  });

  // Everything above is the Northeast Georgia demo, unchanged by this block.
  // The statewide feed starts from its own PRNG seed, so adding or tuning
  // statewide areas never reshuffles a Northeast Georgia listing.
  console.info("Generating statewide listings…");
  state = 20260926;
  const statewideTotal = STATEWIDE_AREAS.reduce((s, a) => s + a.weight, 0);
  const statewideAreas = allocateAreas(statewideTotal, (a) => a.weight, STATEWIDE_AREAS);
  // Fixtures the mobile work packages test against (Decatur, DeKalb County,
  // Virginia-Highland in buy mode): force the first few of each active.
  const forced = { decatur: 0, dekalb: 0, virginiaHighland: 0 };
  /** One listing from another brokerage in the demo feed. */
  async function addStatewide(area: SeedArea, key: number, activeIf?: GenerateOptions["activeIf"]) {
    const { listing, priceDropFrom } = generateListing(key, {
      area,
      // Derived from the key, so statewide MLS numbers are unique.
      mlsNumber: String(10_500_000 + key),
      activeIf,
    });
    perArea.set(area.slug, (perArea.get(area.slug) ?? 0) + 1);
    // Other brokerages only: Adams Realty's own listings stay in Northeast Georgia.
    const { id } = await db.transaction((tx) =>
      upsertListing(tx, toSource(demoSource), listing, { agentIdsByMlsId, isFeatured: false }),
    );
    if (priceDropFrom) {
      await db.insert(listingEvents).values({
        listingId: id,
        type: "price_change",
        occurredAt: daysAgo(intBetween(3, 15)),
        price: listing.listPrice,
        previousPrice: priceDropFrom,
      });
    }
  }

  for (let j = 0; j < statewideAreas.length; j++) {
    const area = statewideAreas[j];
    await addStatewide(area, total + j + 1, ({ county, mode }) => {
      if (mode !== "sale") return false;
      let force = false;
      if (area.slug === "decatur" && forced.decatur++ < 12) force = true;
      if (county === "DeKalb" && forced.dekalb++ < 4) force = true;
      if (area.slug === "virginia-highland" && forced.virginiaHighland++ < 2) force = true;
      return force;
    });
  }

  // Lake Sinclair and Lake Oconee, after every other statewide listing (the
  // PRNG carries on), so adding them moved none of those.
  const lakeTotal = STATEWIDE_LAKES.reduce((s, a) => s + a.weight, 0);
  const lakeAreas = allocateAreas(lakeTotal, (a) => a.weight, STATEWIDE_LAKES);
  // A lake search must find something for sale on each: the first three of each are active.
  const forcedOnLake = new Map<string, number>();
  for (let j = 0; j < lakeAreas.length; j++) {
    const area = lakeAreas[j];
    await addStatewide(area, total + statewideAreas.length + j + 1, ({ mode }) => {
      const n = forcedOnLake.get(area.slug) ?? 0;
      forcedOnLake.set(area.slug, n + 1);
      return mode === "sale" && n < 3;
    });
  }

  // Lake homes shaped like the real feed: the subdivision in `neighborhood`,
  // the lake only in WaterBodyName. The rest of the seed keeps the lake in
  // `neighborhood`, which the real feed never does, so without these a lake
  // search could break without any test noticing. Unique prices let tests
  // pick each one out.
  for (const [k, f] of LAKE_FIXTURES.entries()) {
    const area = [...AREAS, ...STATEWIDE_AREAS, ...STATEWIDE_LAKES].find((a) => a.slug === f.area)!;
    const key = total + statewideAreas.length + lakeAreas.length + k + 1;
    const { listing } = generateListing(key, {
      area,
      type: "single_family",
      onWater: true,
      mlsNumber: String(10_500_000 + key),
    });
    Object.assign(listing, {
      status: "active",
      transactionType: "sale",
      listPrice: f.price,
      originalListPrice: f.price,
      closePrice: null,
      closeDate: null,
      addressLine1: f.street,
      unitNumber: null,
      neighborhood: f.neighborhood,
      waterBodyName: f.waterBody,
      isWaterfront: true,
    } satisfies Partial<typeof listing>);
    perArea.set(area.slug, (perArea.get(area.slug) ?? 0) + 1);
    await db.transaction((tx) =>
      upsertListing(tx, toSource(demoSource), listing, { agentIdsByMlsId, isFeatured: false }),
    );
  }
  // Georgia MLS IDX rule fixtures (IDX_FIXTURES): demo-feed rows in each hidden
  // status, a sold one with several photos, and one with the attribution fields.
  const decatur = STATEWIDE_AREAS.find((a) => a.slug === "decatur")!;
  for (const [k, f] of IDX_FIXTURES.entries()) {
    const key = total + statewideAreas.length + lakeAreas.length + LAKE_FIXTURES.length + k + 1;
    const { listing } = generateListing(key, {
      area: decatur,
      type: "single_family",
      mlsNumber: f.mlsNumber,
    });
    const sold = f.status === "closed";
    // Dates in order whatever generateListing drew: listed 60 days ago, and the status
    // (sold, withdrawn, …) changed 12 days ago; Coming Soon lists a week from now.
    const listDate = f.status === "coming_soon" ? daysAgo(-7) : daysAgo(60);
    const changed = f.status === "active" ? listDate : daysAgo(12);
    Object.assign(listing, {
      status: f.status,
      transactionType: "sale",
      listPrice: f.price,
      originalListPrice: f.price,
      closePrice: sold ? f.price - 1_000 : null,
      listDate: isoDate(listDate),
      closeDate: sold ? isoDate(changed) : null,
      statusChangedAt: f.status === "coming_soon" ? daysAgo(2) : changed,
      sourceModifiedAt: f.status === "coming_soon" ? daysAgo(2) : changed,
      addressLine1: f.street,
      unitNumber: null,
      ...("attribution" in f ? f.attribution : {}),
    } satisfies Partial<typeof listing>);
    if (listing.media.filter((m) => m.kind === "photo").length < 3) {
      throw new Error(
        `IDX fixture ${f.mlsNumber} needs several photos to test the primary-only rule`,
      );
    }
    const { id } = await db.transaction((tx) =>
      upsertListing(tx, toSource(demoSource), listing, { agentIdsByMlsId, isFeatured: false }),
    );
    if (f.status === "withdrawn") {
      await db.insert(savedListings).values({ userId: buyerId, listingId: id });
    }
  }
  // The firm's own listings in each hidden status (FIRM_HIDDEN_FIXTURES): entered
  // by hand, so only the dashboard shows them. Last, so no other row's draw moves.
  const daniel = agentRows.find((a) => a.email === "daniel@adamsrealty.example")!;
  const carnesville = areaBySlug.get("carnesville")!;
  for (const [k, f] of FIRM_HIDDEN_FIXTURES.entries()) {
    const key =
      total +
      statewideAreas.length +
      lakeAreas.length +
      LAKE_FIXTURES.length +
      IDX_FIXTURES.length +
      k +
      1;
    const { listing } = generateListing(key, {
      area: carnesville,
      type: "single_family",
      mlsNumber: f.mlsNumber,
    });
    const listDate = f.status === "coming_soon" ? daysAgo(-7) : daysAgo(60);
    const changed = f.status === "coming_soon" ? daysAgo(2) : daysAgo(12);
    Object.assign(listing, {
      status: f.status,
      transactionType: "sale",
      listPrice: f.price,
      originalListPrice: f.price,
      closePrice: null,
      closeDate: null,
      listDate: isoDate(listDate),
      statusChangedAt: changed,
      sourceModifiedAt: changed,
      addressLine1: f.street,
      unitNumber: null,
      listAgentName: daniel.name,
      listAgentEmail: daniel.email,
      listAgentPhone: daniel.phone,
      listOfficeName: "Adams Realty, Inc.",
      listOfficeMlsId: OFFICE_MLS_ID,
      listAgentMlsId: daniel.mlsAgentId,
      openHouses: [],
    } satisfies Partial<typeof listing>);
    await db.transaction((tx) =>
      upsertListing(tx, toSource(manualSource), listing, {
        listAgentId: daniel.id,
        isFeatured: false,
      }),
    );
  }
  // Autocomplete reads the `places` view; a sync, a seed or a dashboard edit rebuilds it.
  await refreshPlaces(db);
  await assertStatewideFixtures();

  const [{ count }] = await db
    .execute<{ count: string }>(sql`select count(*)::text as count from listings`)
    .then((r) => r.rows);
  const perAgent = new Map<string, number>();
  for (const l of ourListings) perAgent.set(l.agentId, (perAgent.get(l.agentId) ?? 0) + 1);
  console.info(`\nSeeded ${count} listings, ${agentRows.length} agents.`);
  console.info("By area: %s", AREAS.map((a) => `${a.slug} ${perArea.get(a.slug) ?? 0}`).join(", "));
  console.info(
    "Statewide: %s",
    [...STATEWIDE_AREAS, ...STATEWIDE_LAKES]
      .map((a) => `${a.slug} ${perArea.get(a.slug) ?? 0}`)
      .join(", "),
  );
  console.info(
    "Adams listings by agent: %s\n",
    agentRows.map((a) => `${a.name} ${perAgent.get(a.id) ?? 0}`).join(", "),
  );
  console.info("Demo logins (password: %s)", password);
  console.info("  admin   admin@adamsrealty.example   (Andrea Anderegg, broker)");
  console.info("  agent   daniel@adamsrealty.example  (sample agent)");
  console.info("  agent   priya@adamsrealty.example   (sample agent)");
  console.info("  buyer   buyer@example.com\n");
}

/** Every county a Northeast Georgia area's sites fall in. */
function northeastCounties(): string[] {
  const counties = new Set<string>();
  for (const a of AREAS) {
    for (const rows of Object.values(siteRows[a.slug] ?? {})) {
      for (const row of rows ?? []) counties.add(String(row[2]));
    }
  }
  return [...counties];
}

/**
 * Seed-time checks for data other code relies on. A PRNG or pool change that
 * breaks one fails the seed loudly instead of breaking a test later.
 */
async function assertStatewideFixtures() {
  const buy = (c: Partial<SearchCriteria>) =>
    searchListings({ ...DEFAULT_CRITERIA, ...c }).then((r) => r.total);
  const live = async (where: ReturnType<typeof sql>) => {
    const [{ n }] = await db
      .execute<{ n: number }>(
        sql`select count(*)::int as n from listings where removed_at is null and not idx_hidden and ${where}`,
      )
      .then((r) => r.rows);
    return n;
  };
  const checks: Array<[string, boolean]> = [
    ["/homes?q=Decatur has at least 10 results", (await buy({ q: "Decatur" })) >= 10],
    ["/homes?q=Decatur&beds=3 has a result", (await buy({ q: "Decatur", beds: 3 })) >= 1],
    [
      "an active DeKalb County home for sale",
      (await live(sql`county = 'DeKalb' and status = 'active' and transaction_type = 'sale'`)) >= 1,
    ],
    ["/homes?q=Virginia-Highland has a result", (await buy({ q: "Virginia-Highland" })) >= 1],
    // Georgia MLS IDX rules: the hidden-status fixtures are nowhere in search.
    ...(await Promise.all(
      IDX_FIXTURES.filter((f) => f.status !== "active" && f.status !== "closed").map(
        async (f): Promise<[string, boolean]> => [
          `the ${f.status} feed fixture ${f.mlsNumber} is hidden from search`,
          (await buy({ q: f.mlsNumber, pending: true })) === 0 &&
            (await buy({ q: f.mlsNumber, mode: "sold" })) === 0,
        ],
      ),
    )),
    [
      "the active feed fixture 10599006 is found by its MLS number",
      (await buy({ q: "10599006" })) === 1,
    ],
    // The firm hides its own listings in those statuses too, and still manages them.
    ...(await Promise.all(
      FIRM_HIDDEN_FIXTURES.map(async (f): Promise<[string, boolean]> => {
        const [row] = await db
          .execute<{ hidden: boolean; manual: boolean; status: string }>(
            sql`select l.idx_hidden as hidden, s.kind = 'manual' as manual, l.status
                  from listings l join data_sources s on s.id = l.source_id
                 where l.mls_number = ${f.mlsNumber}`,
          )
          .then((r) => r.rows);
        return [
          `the firm's own ${f.status} fixture ${f.mlsNumber} is hidden from the public`,
          !!row &&
            row.manual &&
            row.hidden &&
            row.status === f.status &&
            (await buy({ q: f.mlsNumber, pending: true })) === 0 &&
            (await buy({ q: f.mlsNumber, mode: "sold" })) === 0,
        ];
      }),
    )),
    ["no more than 750 live listings (the map's pin cap)", (await live(sql`true`)) <= 750],
    [
      "no listing sold before it was listed, and no history event before its listing",
      (await db
        .execute<{ n: number }>(
          sql`select count(*)::int as n from listings l
               where l.close_date < l.list_date
                  or exists (select 1 from listing_events e
                              where e.listing_id = l.id and e.type <> 'listed'
                                and e.occurred_at < (select min(occurred_at) from listing_events f
                                                      where f.listing_id = l.id and f.type = 'listed'))`,
        )
        .then((r) => r.rows[0].n)) === 0,
    ],
    [
      "no Adams Realty listing outside the Northeast Georgia areas' counties",
      (await live(
        sql`is_company_listing and county not in (${sql.join(
          northeastCounties().map((c) => sql`${c}`),
          sql`, `,
        )})`,
      )) === 0,
    ],
  ];
  // The data-driven town lists (home page chips, footer, "See all towns") against a direct
  // count of what /homes shows by default: homes for sale, commercial property left out.
  const forSale = sql`transaction_type = 'sale' and status in ('active', 'coming_soon') and property_type <> 'commercial'`;
  const byCity = await db
    .execute<{ city: string; n: number }>(
      sql`select city, count(*)::int as n from listings where removed_at is null and not idx_hidden and ${forSale}
          group by city order by n desc, city`,
    )
    .then((r) => r.rows);
  const top = await getTopCities(12);
  const places = await getPlacesIndex();
  const placeCities = new Set(places.flatMap((p) => p.cities.map((c) => c.city)));
  // Each town chip links to /homes?q=<city>, which must find at least the homes it counted.
  for (const c of top) {
    checks.push([
      `town chip "${c.city}" (${c.count} for sale) finds its homes`,
      (await buy({ q: c.city })) >= c.count,
    ]);
  }
  checks.push(
    ["the home page has more than 5 town chips", top.length > 5],
    [
      "at least 4 active Adams or firm-area homes for the featured block",
      (await getFeaturedListings(8)).length >= FEATURED_MIN,
    ],
    [
      "getTopCities(12) is the 12 busiest cities, busiest first",
      JSON.stringify(top.map((c) => [c.city, c.count])) ===
        JSON.stringify(byCity.slice(0, 12).map((c) => [c.city, c.n])),
    ],
    [
      "getPlacesIndex lists every city with homes for sale, and every home once",
      byCity.every((c) => placeCities.has(c.city)) &&
        places.flatMap((p) => p.cities).reduce((s, c) => s + c.count, 0) ===
          byCity.reduce((s, c) => s + c.n, 0),
    ],
  );
  // Autocomplete (the `places` view) counts the same live listings as a direct query.
  const decatur = await live(
    sql`city = 'Decatur' and status in ('active', 'coming_soon', 'active_under_contract', 'pending')`,
  );
  const suggested = await getLocationSuggestions("Decat");
  checks.push([
    `autocomplete "Decat" suggests Decatur with its ${decatur} live listings`,
    suggested.some((s) => s.kind === "city" && s.label === "Decatur" && s.count === decatur),
  ]);
  for (const lake of STATEWIDE_LAKES) {
    checks.push([`/homes?q=${lake.name} finds homes there`, (await buy({ q: lake.name })) >= 3]);
  }
  // Each lake fixture sits on its lake: pin within the lake's extent, description naming it.
  for (const f of LAKE_FIXTURES) {
    const lake = [...AREAS, ...STATEWIDE_LAKES].find((a) => a.slug === f.area)!;
    const b = lake.lakeBounds!;
    const [home] = await db
      .execute<{ lat: number; lng: number; description: string }>(
        sql`select latitude as lat, longitude as lng, description from listings
            where address_line1 = ${f.street} and list_price = ${f.price}`,
      )
      .then((r) => r.rows);
    const margin = 0.01; // about 1 km: waterfront sites are within 150 m of the shore
    checks.push([
      `${f.street} is on ${lake.name}: pin within its extent, description naming it`,
      !!home &&
        home.lat >= b.south - margin &&
        home.lat <= b.north + margin &&
        home.lng >= b.west - margin &&
        home.lng <= b.east + margin &&
        home.description.includes(`on ${lake.name}`),
    ]);
  }
  for (const f of LAKE_FIXTURES) {
    checks.push([
      `/homes?q=${f.query} finds ${f.street} (lake only in WaterBodyName "${f.waterBody}")`,
      (await buy({ q: f.query, minPrice: f.price, maxPrice: f.price })) === 1,
    ]);
  }
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  if (failed.length) throw new Error(`Seed fixtures missing:\n- ${failed.join("\n- ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
