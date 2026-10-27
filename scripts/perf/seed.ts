/**
 * Builds `adams_perf`: a synthetic statewide Georgia MLS feed at production
 * scale, for `npm run perf:measure`. Dev-only; never run in CI.
 *
 *   npm run perf:seed                 # drop + create adams_perf, migrate, generate (~3 min)
 *   npm run perf:seed -- --migrate    # only apply pending migrations to an existing adams_perf
 *   npm run perf:drop                 # drop adams_perf
 *
 * Volume (about 220k listings, 4M+ photo rows):
 * - 45,000 for sale (42,500 active, 2,500 coming soon)
 * - 5,000 active rentals, 500 leased (closed rentals)
 * - 3,000 under contract and 5,000 pending (the `pending=1` toggle)
 * - 150,000 closed sales in the last 365 days (sold mode's window), plus
 *   10,000 older closed sales the window must skip
 * - 1,500 withdrawn/expired/canceled rows with `removed_at` set
 *
 * Shaped like the real feed, not like the demo seed: `neighborhood` holds a
 * subdivision name (RESO SubdivisionName), lake homes carry the lake only in
 * `water_body` (RESO WaterBodyName), metro descriptions say "minutes to
 * downtown Atlanta", and Athens and Gainesville have "Atlanta Highway"
 * addresses. Three fixture listings sit alone in a tiny rural box, for the
 * "small box" measurement.
 *
 * Rows are inserted with plain multi-row INSERTs rather than `upsertListing`
 * (the app's single write path): 220k listings through it would take about
 * 15 minutes, and this database is synthetic and thrown away. Photo rows are
 * generated server-side from each listing's `photo_count`.
 */
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { keywordText } from "@/lib/search/keyword-text";
import { adminUrl, assertPerfUrl, PERF_DB, PERF_URL, SMALL_BOX } from "./perf-db";

const url = assertPerfUrl(PERF_URL);
const args = new Set(process.argv.slice(2));

let state = 20260925;
function rnd() {
  // mulberry32
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = () => {
  let u = 0;
  let v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const intBetween = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p: number) => rnd() < p;
const logn = (median: number, sigma: number) => median * Math.exp(sigma * gauss());

type City = {
  city: string;
  county: string;
  lat: number;
  lng: number;
  zip: string;
  weight: number;
  spreadKm: number;
  priceMult: number;
  metro: boolean;
  lake?: string;
};

// [city, county, lat, lng, zip, weight, spreadKm, priceMult, metro, lake]
const CITIES: City[] = (
  [
    ["Atlanta", "Fulton", 33.749, -84.388, "30303", 12, 10, 1.2, 1],
    ["Sandy Springs", "Fulton", 33.924, -84.379, "30328", 2.5, 5, 1.5, 1],
    ["Roswell", "Fulton", 34.023, -84.362, "30075", 2, 5, 1.4, 1],
    ["Alpharetta", "Fulton", 34.075, -84.294, "30009", 2.5, 6, 1.6, 1],
    ["Johns Creek", "Fulton", 34.029, -84.199, "30097", 1.5, 5, 1.5, 1],
    ["Milton", "Fulton", 34.132, -84.301, "30004", 1, 5, 1.8, 1],
    ["Marietta", "Cobb", 33.953, -84.55, "30060", 3.5, 7, 1.1, 1],
    ["Kennesaw", "Cobb", 34.023, -84.616, "30144", 2, 5, 1.0, 1],
    ["Smyrna", "Cobb", 33.884, -84.514, "30080", 1.5, 4, 1.1, 1],
    ["Acworth", "Cobb", 34.066, -84.678, "30101", 1.5, 5, 1.0, 1, "Lake Allatoona"],
    ["Decatur", "DeKalb", 33.775, -84.296, "30030", 2, 5, 1.1, 1],
    ["Stone Mountain", "DeKalb", 33.808, -84.17, "30083", 2, 6, 0.8, 1],
    ["Lithonia", "DeKalb", 33.712, -84.105, "30058", 1.5, 5, 0.7, 1],
    ["Dunwoody", "DeKalb", 33.946, -84.334, "30338", 1, 3, 1.3, 1],
    ["Lawrenceville", "Gwinnett", 33.956, -83.988, "30044", 3, 6, 0.95, 1],
    ["Duluth", "Gwinnett", 34.003, -84.145, "30096", 1.5, 4, 1.1, 1],
    ["Snellville", "Gwinnett", 33.857, -84.02, "30078", 1.5, 4, 0.95, 1],
    ["Buford", "Gwinnett", 34.121, -84.004, "30518", 1.5, 5, 1.1, 1, "Lake Lanier"],
    ["Suwanee", "Gwinnett", 34.051, -84.071, "30024", 1.2, 4, 1.2, 1],
    ["Cumming", "Forsyth", 34.207, -84.14, "30040", 3, 8, 1.3, 1, "Lake Lanier"],
    ["Canton", "Cherokee", 34.237, -84.491, "30114", 2, 7, 1.05, 1],
    ["Woodstock", "Cherokee", 34.101, -84.519, "30188", 2, 5, 1.1, 1],
    ["Dallas", "Paulding", 33.924, -84.841, "30132", 2, 7, 0.85, 1],
    ["Douglasville", "Douglas", 33.751, -84.748, "30135", 2, 6, 0.85, 1],
    ["McDonough", "Henry", 33.447, -84.147, "30253", 2.5, 7, 0.85, 1],
    ["Jonesboro", "Clayton", 33.522, -84.354, "30236", 1.5, 5, 0.7, 1],
    ["Newnan", "Coweta", 33.381, -84.8, "30263", 2, 8, 0.95, 1],
    ["Peachtree City", "Fayette", 33.397, -84.596, "30269", 1.2, 4, 1.2, 1],
    ["Covington", "Newton", 33.597, -83.86, "30014", 1.5, 7, 0.8, 1],
    ["Conyers", "Rockdale", 33.668, -84.018, "30012", 1.2, 5, 0.8, 1],
    ["Cartersville", "Bartow", 34.165, -84.8, "30120", 1.5, 8, 0.85, 1],
    ["Braselton", "Jackson", 34.109, -83.763, "30517", 0.7, 4, 1.05, 1],
    ["Gainesville", "Hall", 34.298, -83.824, "30501", 2, 8, 0.95, 1, "Lake Lanier"],
    ["Flowery Branch", "Hall", 34.185, -83.925, "30542", 0.8, 4, 1.0, 1, "Lake Lanier"],
    ["Savannah", "Chatham", 32.081, -81.091, "31401", 4, 9, 1.0, 0],
    ["Pooler", "Chatham", 32.115, -81.247, "31322", 1, 4, 0.95, 0],
    ["Richmond Hill", "Bryan", 31.938, -81.303, "31324", 0.8, 5, 1.0, 0],
    ["Augusta", "Richmond", 33.474, -82.01, "30901", 3, 9, 0.7, 0],
    ["Evans", "Columbia", 33.534, -82.131, "30809", 1.2, 5, 0.95, 0, "Clarks Hill Lake"],
    ["Columbus", "Muscogee", 32.461, -84.988, "31901", 2.5, 9, 0.65, 0],
    ["Macon", "Bibb", 32.841, -83.632, "31201", 2.5, 9, 0.6, 0],
    ["Warner Robins", "Houston", 32.614, -83.624, "31088", 1.5, 6, 0.7, 0],
    ["Athens", "Clarke", 33.951, -83.357, "30601", 2, 7, 0.95, 0],
    ["Albany", "Dougherty", 31.578, -84.156, "31701", 1, 7, 0.5, 0],
    ["Valdosta", "Lowndes", 30.833, -83.278, "31601", 1, 7, 0.6, 0],
    ["Brunswick", "Glynn", 31.15, -81.491, "31520", 0.7, 6, 0.8, 0],
    ["St. Simons Island", "Glynn", 31.15, -81.387, "31522", 0.5, 3, 1.8, 0],
    ["Dalton", "Whitfield", 34.77, -84.97, "30720", 0.8, 7, 0.65, 0],
    ["Rome", "Floyd", 34.257, -85.165, "30161", 1, 8, 0.65, 0],
    ["Blue Ridge", "Fannin", 34.864, -84.324, "30513", 0.8, 9, 1.0, 0, "Lake Blue Ridge"],
    ["Dahlonega", "Lumpkin", 34.533, -83.985, "30533", 0.6, 8, 0.9, 0],
    ["Statesboro", "Bulloch", 32.449, -81.783, "30458", 0.7, 7, 0.65, 0],
    ["Thomasville", "Thomas", 30.837, -83.979, "31792", 0.4, 7, 0.6, 0],
    ["Tifton", "Tift", 31.45, -83.508, "31794", 0.4, 6, 0.55, 0],
    ["Milledgeville", "Baldwin", 33.08, -83.232, "31061", 0.5, 7, 0.65, 0, "Lake Sinclair"],
    ["Greensboro", "Greene", 33.576, -83.182, "30642", 0.5, 7, 1.6, 0, "Lake Oconee"],
    ["Waycross", "Ware", 31.213, -82.354, "31501", 0.3, 6, 0.45, 0],
    ["Dublin", "Laurens", 32.54, -82.904, "31021", 0.35, 7, 0.5, 0],
    ["Hinesville", "Liberty", 31.846, -81.596, "31313", 0.6, 6, 0.65, 0],
    ["Kingsland", "Camden", 30.8, -81.69, "31548", 0.5, 6, 0.75, 0],
    ["LaGrange", "Troup", 33.039, -85.031, "30240", 0.7, 7, 0.65, 0, "West Point Lake"],
    ["Carrollton", "Carroll", 33.58, -85.077, "30117", 0.8, 8, 0.75, 0],
    ["Griffin", "Spalding", 33.247, -84.264, "30223", 0.6, 6, 0.65, 0],
    ["Calhoun", "Gordon", 34.503, -84.951, "30701", 0.5, 7, 0.65, 0],
    ["Ellijay", "Gilmer", 34.695, -84.482, "30540", 0.6, 9, 0.85, 0],
    ["Clayton", "Rabun", 34.878, -83.401, "30525", 0.4, 8, 1.1, 0, "Lake Burton"],
    ["Madison", "Morgan", 33.595, -83.468, "30650", 0.35, 7, 1.0, 0],
    ["Monroe", "Walton", 33.795, -83.713, "30655", 0.6, 6, 0.85, 0],
    ["Eatonton", "Putnam", 33.327, -83.388, "31024", 0.4, 8, 1.1, 0, "Lake Oconee"],
    ["Royston", "Franklin", 34.287, -83.11, "30662", 0.25, 5, 0.6, 0],
    ["Lavonia", "Franklin", 34.436, -83.107, "30553", 0.25, 5, 0.75, 0, "Lake Hartwell"],
    ["Hartwell", "Hart", 34.353, -82.932, "30643", 0.35, 7, 0.8, 0, "Lake Hartwell"],
    ["Toccoa", "Stephens", 34.577, -83.332, "30577", 0.35, 6, 0.6, 0],
    ["Commerce", "Jackson", 34.204, -83.457, "30529", 0.3, 5, 0.8, 0],
    ["Jefferson", "Jackson", 34.117, -83.572, "30549", 0.4, 5, 0.95, 0],
    ["Danielsville", "Madison", 34.124, -83.221, "30633", 0.15, 6, 0.65, 0],
    ["Carnesville", "Franklin", 34.37, -83.235, "30521", 0.1, 5, 0.6, 0],
  ] as const
).map(([city, county, lat, lng, zip, weight, spreadKm, priceMult, metro, lake]) => ({
  city,
  county,
  lat,
  lng,
  zip,
  weight,
  spreadKm,
  priceMult,
  metro: metro === 1,
  lake,
}));
const TOTAL_WEIGHT = CITIES.reduce((s, c) => s + c.weight, 0);
function pickCity(): City {
  let r = rnd() * TOTAL_WEIGHT;
  for (const c of CITIES) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return CITIES[0];
}

const SUB_A = [
  "Oak",
  "Willow",
  "Magnolia",
  "Cedar",
  "Pine",
  "Hickory",
  "Dogwood",
  "Laurel",
  "River",
  "Brook",
  "Stone",
  "Meadow",
  "Chestnut",
  "Heritage",
  "Ashford",
  "Crest",
  "Fox",
  "Eagle",
  "Bridge",
  "Hamilton",
  "Windsor",
  "Kingston",
  "Belmont",
  "Sutton",
  "Grayson",
  "Harbor",
  "Mill",
  "Park",
  "Summer",
  "Twin",
  "Walnut",
  "Peachtree",
];
const SUB_B = [
  "Creek",
  "Grove",
  "Estates",
  "Park",
  "Village",
  "Ridge",
  "Hills",
  "Landing",
  "Point",
  "Farms",
  "Glen",
  "Walk",
  "Place",
  "Station",
  "Commons",
  "Trace",
  "Reserve",
  "Crossing",
  "Preserve",
];
const STREETS = [
  ...SUB_A,
  "Main",
  "Church",
  "Maple",
  "Elm",
  "Washington",
  "Jackson",
  "Forest",
  "Hill",
  "Spring",
  "Sunset",
  "Highland",
  "Valley",
  "Holly",
  "Juniper",
  "Poplar",
  "Sycamore",
  "Cardinal",
];
const ST_TYPES = [
  "Road",
  "Drive",
  "Street",
  "Lane",
  "Court",
  "Way",
  "Trail",
  "Circle",
  "Place",
  "Run",
];
const BROKERS = [
  "Keller Williams Realty",
  "Coldwell Banker Realty",
  "RE/MAX Center",
  "eXp Realty",
  "Compass",
  "Harry Norman Realtors",
  "Atlanta Fine Homes",
  "Real Broker",
  "Local Realty Group",
];
const PHRASES = [
  "The open floor plan connects the kitchen, dining and family room.",
  "The kitchen features quartz counters, a large island and a walk-in pantry.",
  "The primary suite offers a tray ceiling, dual vanities and a separate shower.",
  "Secondary bedrooms are generously sized with ample closet space.",
  "The finished basement adds a media room, a guest suite and storage.",
  "A screened porch overlooks a level, fenced backyard with mature trees.",
  "The community offers a swim and tennis package and walking trails.",
  "New roof, new HVAC and a new water heater within the last three years.",
  "Easy access to shopping, dining and parks.",
  "The two-car garage includes built-in storage.",
  "Freshly painted interior and new carpet in the bedrooms.",
  "A bonus room over the garage works as an office or playroom.",
];
const PHOTO =
  "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1600&q=80";

type Plan = {
  status: string;
  tx: "sale" | "rent";
  removed: boolean;
  closedDaysAgo?: [number, number];
};
function statusPlan(): Plan[] {
  const out: Plan[] = [];
  const add = (n: number, p: Plan) => {
    for (let i = 0; i < n; i++) out.push(p);
  };
  add(42_500, { status: "active", tx: "sale", removed: false });
  add(2_500, { status: "coming_soon", tx: "sale", removed: false });
  add(5_000, { status: "active", tx: "rent", removed: false });
  add(500, { status: "closed", tx: "rent", removed: false, closedDaysAgo: [1, 365] });
  add(3_000, { status: "active_under_contract", tx: "sale", removed: false });
  add(5_000, { status: "pending", tx: "sale", removed: false });
  add(150_000, { status: "closed", tx: "sale", removed: false, closedDaysAgo: [1, 364] });
  add(10_000, { status: "closed", tx: "sale", removed: false, closedDaysAgo: [367, 730] });
  for (let i = 0; i < 1_500; i++) {
    out.push({ status: pick(["withdrawn", "expired", "canceled"]), tx: "sale", removed: true });
  }
  // Shuffle so the heap's physical order doesn't follow status (a real feed's doesn't).
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const NOW = new Date("2026-09-25T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const COLS = [
  "id",
  "source_id",
  "listing_key",
  "mls_number",
  "slug",
  "status",
  "transaction_type",
  "property_type",
  "list_price",
  "original_list_price",
  "close_price",
  "list_date",
  "close_date",
  "bedrooms",
  "bathrooms_full",
  "bathrooms_half",
  "bathrooms",
  "living_area_sqft",
  "lot_size_sqft",
  "year_built",
  "stories",
  "garage_spaces",
  "hoa_fee",
  "hoa_frequency",
  "tax_annual_amount",
  "address_line1",
  "unit_number",
  "city",
  "state",
  "postal_code",
  "county",
  "neighborhood",
  "water_body",
  "latitude",
  "longitude",
  "description",
  "has_pool",
  "is_waterfront",
  "has_view",
  "has_basement",
  "is_new_construction",
  "is_single_story",
  "primary_photo_url",
  "photo_count",
  "list_agent_name",
  "list_office_name",
  "list_office_mls_id",
  "is_company_listing",
  "is_featured",
  "source_modified_at",
  "removed_at",
  // Inserted as to_tsvector of the text (insertRows), as upsertListings stores it.
  "keyword_tsv",
] as const;

type Fixture = Partial<{ city: City; lat: number; lng: number; street: string; plan: Plan }>;

function makeListing(i: number, sourceId: string, plan: Plan, fx: Fixture = {}) {
  const c = fx.city ?? pickCity();
  const { status, tx } = plan;
  const r = rnd();
  let type =
    tx === "rent"
      ? r < 0.6
        ? "single_family"
        : r < 0.8
          ? "townhouse"
          : "condo"
      : r < 0.68
        ? "single_family"
        : r < 0.74
          ? "condo"
          : r < 0.83
            ? "townhouse"
            : r < 0.955
              ? "land"
              : r < 0.965
                ? "farm_ranch"
                : r < 0.98
                  ? "manufactured"
                  : r < 0.99
                    ? "multi_family"
                    : "commercial";
  if (!c.metro && (type === "condo" || type === "townhouse") && chance(0.6)) type = "single_family";
  const isLand = type === "land" || type === "farm_ranch";
  const hasHome = !(type === "land" || type === "commercial");

  const lat = fx.lat ?? Math.min(34.98, Math.max(30.4, c.lat + (gauss() * c.spreadKm) / 111));
  const lng =
    fx.lng ??
    Math.min(
      -80.9,
      Math.max(-85.58, c.lng + (gauss() * c.spreadKm) / (111 * Math.cos((c.lat * Math.PI) / 180))),
    );
  // Real feeds: the subdivision in `neighborhood`, the lake only in WaterBodyName.
  const onLake = !!c.lake && chance(0.3);
  const neighborhood = chance(c.metro ? 0.75 : 0.35) ? `${pick(SUB_A)} ${pick(SUB_B)}` : null;
  const zip = String(Number(c.zip) + (chance(0.5) ? intBetween(0, 12) : 0)).padStart(5, "0");

  const sqft = hasHome
    ? Math.round(
        Math.min(
          9000,
          Math.max(600, logn(type === "condo" ? 1250 : type === "townhouse" ? 1800 : 2200, 0.35)),
        ),
      )
    : null;
  const acres = isLand
    ? Math.max(0.2, logn(type === "farm_ranch" ? 40 : 3, 1))
    : chance(0.25)
      ? logn(1.5, 0.8)
      : null;
  const lot = acres
    ? Math.round(acres * 43_560)
    : hasHome && type !== "condo"
      ? intBetween(6000, 25_000)
      : null;
  const pm = c.priceMult;
  let price: number;
  if (tx === "rent") price = Math.round(logn(2100 * pm, 0.35) / 25) * 25;
  else if (type === "land")
    price = Math.round((logn(20_000 * pm, 0.6) * Math.pow(acres!, 0.8)) / 500) * 500;
  else if (type === "farm_ranch") price = Math.round(logn(750_000 * pm, 0.6) / 1000) * 1000;
  else if (type === "commercial") price = Math.round(logn(600_000 * pm, 0.9) / 1000) * 1000;
  else price = Math.round((sqft! * logn(165 * pm, 0.3)) / 1000) * 1000;
  price = Math.max(tx === "rent" ? 600 : 5000, price);
  const beds = hasHome ? Math.max(1, Math.min(8, Math.round(sqft! / 650 + gauss() * 0.6))) : null;
  const bf = hasHome ? Math.max(1, Math.min(7, Math.round(sqft! / 900 + gauss() * 0.5))) : null;
  const bh = hasHome ? (chance(0.5) ? 1 : 0) : null;
  const year = hasHome
    ? Math.min(2026, Math.max(1900, Math.round(2026 - Math.abs(logn(25, 0.9)))))
    : null;
  const stories = hasHome ? (type === "condo" ? 1 : pick([1, 1, 2, 2, 2, 3])) : null;
  const hoa =
    hasHome && (type !== "single_family" || chance(c.metro ? 0.5 : 0.15))
      ? intBetween(25, type === "condo" ? 600 : 250)
      : null;

  let listDate: string;
  let closeDate: string | null = null;
  let closePrice: number | null = null;
  if (status === "coming_soon")
    listDate = iso(new Date(NOW.getTime() + intBetween(0, 14) * 86_400_000));
  else if (status === "active")
    listDate = iso(daysAgo(Math.min(400, Math.floor(-Math.log(1 - rnd()) * 50))));
  else if (status === "closed") {
    const [lo, hi] = plan.closedDaysAgo ?? [1, 364];
    const cd = intBetween(lo, hi);
    closeDate = iso(daysAgo(cd));
    listDate = iso(daysAgo(cd + intBetween(20, 120)));
    closePrice = Math.round(price * (0.93 + rnd() * 0.1));
  } else listDate = iso(daysAgo(intBetween(10, 150)));
  const original = chance(0.3) ? Math.round(price * (1.03 + rnd() * 0.1)) : price;

  const photoCount = isLand
    ? intBetween(3, 12)
    : type === "commercial"
      ? intBetween(5, 20)
      : intBetween(10, 40);
  const words = Array.from({ length: intBetween(4, 8) }, () => pick(PHRASES)).join(" ");
  const place = neighborhood ?? c.city;
  const description =
    `Welcome to this ${type.replace("_", " ")} in ${place}. ${words}` +
    (onLake ? ` Enjoy ${c.lake} from the dock.` : "") +
    (c.metro ? ` Just ${intBetween(15, 45)} minutes to downtown Atlanta.` : "") +
    ` Schedule your showing today in ${c.city}!`;
  const street =
    fx.street ??
    ((c.city === "Athens" || c.city === "Gainesville") && chance(0.04)
      ? `${intBetween(100, 9999)} Atlanta Highway`
      : `${intBetween(10, 9999)} ${pick(STREETS)} ${pick(ST_TYPES)}`);
  const unit = type === "condo" ? String(intBetween(100, 2400)) : null;
  const key = `GAMLS${String(10_000_000 + i)}`;
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 6);
  const company =
    ["Royston", "Lavonia", "Hartwell", "Toccoa", "Commerce", "Carnesville"].includes(c.city) &&
    chance(0.05);
  const pool = hasHome && chance(0.08);
  const water = onLake && chance(0.6);
  const updated = new Date(NOW.getTime() - rnd() * 3 * 86_400_000);

  return [
    randomUUID(),
    sourceId,
    key,
    String(10_100_000 + i),
    `${slugify(`${street} ${c.city} ga ${zip}`)}-${hash}`,
    status,
    tx,
    type,
    price,
    original,
    closePrice,
    listDate,
    closeDate,
    beds,
    bf,
    bh,
    hasHome ? bf! + 0.5 * bh! : null,
    sqft,
    lot,
    year,
    stories,
    hasHome ? pick([0, 1, 2, 2, 2, 3]) : null,
    hoa,
    hoa ? "monthly" : null,
    tx === "sale" ? Math.round(price * 0.009) : null,
    street,
    unit,
    c.city,
    "GA",
    zip,
    c.county,
    neighborhood,
    onLake ? c.lake : null,
    lat,
    lng,
    description,
    pool,
    water,
    water || chance(0.1),
    hasHome && c.metro && chance(0.3),
    hasHome && year! >= 2025 && chance(0.7),
    stories === 1 && hasHome && type !== "condo",
    PHOTO,
    photoCount,
    `${pick(["Chris", "Jordan", "Taylor", "Morgan", "Alex", "Casey"])} ${pick(["Nguyen", "Smith", "Garcia", "Patel", "Lee"])}`,
    company ? "Adams Realty, Inc." : pick(BROKERS),
    company ? "ADAM01" : `OFF${intBetween(100, 4000)}`,
    company,
    company && chance(0.3),
    updated,
    plan.removed ? daysAgo(intBetween(1, 200)) : null,
    keywordText({
      addressLine1: street,
      city: c.city,
      postalCode: zip,
      neighborhood,
      mlsNumber: String(10_100_000 + i),
      description,
    }),
  ];
}

async function insertRows(c: Client, rows: unknown[][]) {
  if (!rows.length) return;
  const values: unknown[] = [];
  const tuples = rows.map((r) => {
    const base = values.length;
    values.push(...r);
    return `(${r
      .map((_, j) =>
        COLS[j] === "keyword_tsv" ? `to_tsvector('english', $${base + j + 1})` : `$${base + j + 1}`,
      )
      .join(",")})`;
  });
  await c.query(`insert into listings (${COLS.join(",")}) values ${tuples.join(",")}`, values);
}

async function recreateDatabase() {
  const admin = new Client({ connectionString: adminUrl(url) });
  await admin.connect();
  await admin.query(`drop database if exists ${PERF_DB} with (force)`);
  await admin.query(`create database ${PERF_DB}`);
  await admin.end();
}

async function applyMigrations() {
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });
  await pool.end();
}

async function main() {
  if (args.has("--drop")) {
    const admin = new Client({ connectionString: adminUrl(url) });
    await admin.connect();
    await admin.query(`drop database if exists ${PERF_DB} with (force)`);
    await admin.end();
    console.info(`dropped ${PERF_DB}`);
    return;
  }
  if (args.has("--migrate")) {
    await applyMigrations();
    const c = new Client({ connectionString: url });
    await c.connect();
    await c.query("vacuum analyze listings");
    await c.end();
    console.info(`migrated ${PERF_DB}`);
    return;
  }

  const t0 = Date.now();
  await recreateDatabase();
  await applyMigrations();
  const c = new Client({ connectionString: url });
  await c.connect();
  const {
    rows: [src],
  } = await c.query<{ id: string }>(
    `insert into data_sources (slug, name, kind, config, disclaimer, last_synced_at)
     values ('georgia-mls', 'Georgia MLS (synthetic perf data)', 'reso_web_api',
       '{"companyOfficeIds":["ADAM01"]}', 'Synthetic data for performance testing.', now())
     returning id`,
  );

  const plans = statusPlan();
  let batch: unknown[][] = [];
  for (let i = 0; i < plans.length; i++) {
    batch.push(makeListing(i, src.id, plans[i]));
    if (batch.length === 500) {
      await insertRows(c, batch);
      batch = [];
    }
    if (i % 50_000 === 0)
      console.info(`  ${i} listings, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  // Three homes alone in a tiny rural box: the "small box" measurement.
  const royston = CITIES.find((x) => x.city === "Royston")!;
  const alone = {
    ...royston,
    city: "Nicholls",
    county: "Coffee",
    zip: "31554",
    metro: false,
    lake: undefined,
  };
  for (let k = 0; k < 3; k++) {
    batch.push(
      makeListing(
        plans.length + k,
        src.id,
        { status: "active", tx: "sale", removed: false },
        {
          city: alone,
          lat: SMALL_BOX.south + 0.01 + k * 0.008,
          lng: SMALL_BOX.west + 0.01 + k * 0.008,
        },
      ),
    );
  }
  await insertRows(c, batch);
  console.info(`listings inserted, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  await c.query(`
    insert into listing_media (listing_id, kind, url, width, height, sort_order, source_key)
    select l.id, 'photo',
      'https://images.unsplash.com/photo-16' || lpad((abs(hashtext(l.listing_key || g)) % 1000000000)::text, 9, '0') || '?auto=format&fit=crop&w=1600&q=80',
      1600, 1067, g, l.listing_key || '-M' || g
    from listings l, generate_series(0, l.photo_count - 1) g`);
  console.info(`photos inserted, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await c.query(`
    insert into open_houses (listing_id, starts_at, ends_at)
    select id, timestamptz '2026-09-27 17:00Z', timestamptz '2026-09-27 19:00Z'
    from listings
    where status = 'active' and transaction_type = 'sale' and removed_at is null
      and property_type not in ('land', 'commercial') and abs(hashtext(id::text)) % 10 = 0`);

  // Autocomplete's `places` view was created empty by the migrations.
  await c.query("refresh materialized view places");
  await c.query("vacuum analyze");
  const { rows } = await c.query(
    `select status, transaction_type, count(*)::int n, count(*) filter (where removed_at is not null)::int removed
     from listings group by 1, 2 order by 1, 2`,
  );
  console.table(rows);
  const size = await c.query<{ table: string; mb: number }>(
    `select relname as table, round(pg_total_relation_size(oid) / 1048576.0)::int as mb
     from pg_class where relname in ('listings', 'listing_media', 'open_houses') order by 2 desc`,
  );
  console.table(size.rows);
  const db = await c.query<{ mb: number }>(
    `select round(pg_database_size(current_database()) / 1048576.0)::int as mb`,
  );
  console.info(
    `${PERF_DB}: ${db.rows[0].mb} MB, built in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
