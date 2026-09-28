/**
 * Static inputs for the demo seed: the Northeast Georgia market the firm
 * serves, the statewide sample feed, the team, photo pools and copy fragments.
 *
 * Real vs. sample:
 * - The office (Adams Realty, Inc., 69 Mill Street, Royston) and Andrea
 *   Anderegg's agent profile are real, published facts. Don't embellish
 *   them: her bio, photo, experience and email stay unset or placeholder
 *   until she supplies them.
 * - Every listing, every other agent and every other brokerage is a
 *   FICTIONAL SAMPLE for demonstration only, and the demo data sources carry
 *   a disclaimer saying so (shown in the site footer). Sample agents make no
 *   real-world claims; street names are made up.
 *
 * Coordinates come from `seed-sites.json`: pools of points per area that were
 * checked against USGS hydrography to be on land (and, for "waterfront", on
 * the mainland within 100 m of the lake shore) inside the right county. The
 * statewide pools are built, and every row is re-checked, by
 * `scripts/dev/gen-seed-sites.ts` from Census and USGS data (see its header).
 */

export type SeedPropertyType =
  | "single_family"
  | "condo"
  | "townhouse"
  | "multi_family"
  | "manufactured"
  | "land"
  | "farm_ranch"
  | "commercial";

export type SeedArea = {
  /**
   * Key into seed-sites.json. Northeast Georgia areas match an area guide slug
   * in src/config/areas.ts; statewide areas have no guide.
   */
  slug: string;
  /**
   * Town areas: the city written to listings. Neighborhoods: the neighborhood
   * written to listings. Sites carrying a city and ZIP override both.
   */
  name: string;
  kind: "town" | "lake" | "neighborhood";
  city: string;
  zip: string;
  /**
   * [lat, lng]. Towns: the USGS GNIS populated-place point (downtown), which
   * the "core" pool surrounds. Neighborhoods: the GNIS point for the
   * neighborhood. Lakes: the area guide's map center. Pool distances from it
   * are tested in src/config/coverage.test.ts.
   */
  center: [number, number];
  /** Lakes: the extent of the lake's USGS NHD waterbody polygons. Sites lie within 3 km of it. */
  lakeBounds?: { west: number; south: number; east: number; north: number };
  /**
   * Northeast Georgia towns whose existing "town" rows reach past the 8 km
   * town radius, because the city limits do (Jefferson, Braselton) or come
   * within 300 m (Gainesville; see gen-seed-sites --check). Those rows are
   * frozen. New areas never set this: their town pools stop at 8 km.
   */
  townReachKm?: number;
  /** A city with no countryside of its own: never "rural" sites, no farms or manufactured homes. */
  urban?: boolean;
  /** Share of homes with a mountain view. The chance is drawn only when this is set. */
  mountainViewChance?: number;
  /** Area codes for sample listing-agent phones (default 706, 762, 470). */
  areaCodes?: string[];
  /** Home price per square foot (lake areas: waterfront). */
  ppsf: [number, number];
  sqft: [number, number];
  years: [number, number];
  /** In-town lot size, square feet. */
  lot: [number, number];
  /** Acreage for rural land and farms (lake areas: waterfront lots). */
  acres: [number, number];
  /** Land price per acre (lake areas: waterfront lots). */
  perAcre: [number, number];
  mix: Partial<Record<SeedPropertyType, number>>;
  /** School district for in-town homes; rural homes use the county's district. */
  district?: string;
  /** Share of lake-area homes and lots on the water (the rest are "lake area"). */
  waterfrontChance?: number;
  poolChance?: number;
  basementChance?: number;
  /** Share of houses in a subdivision with an HOA. */
  hoaChance?: number;
  /**
   * Finishes "…, all of it {in Royston}, {vibe}." Place facts only (see the
   * copy rules in src/config/areas.ts), and never the name of another town:
   * descriptions are full-text indexed, so "near Royston" would put this
   * town's listings into a search for Royston.
   */
  vibe: string;
  /** Share of the sample MLS feed (statewide areas: the exact number of listings). */
  weight: number;
  /** Share of Adams Realty's own listings (weighted toward the home office). */
  ourWeight: number;
};

/** County school districts (names as the districts publish them). */
export const COUNTY_DISTRICTS: Record<string, string> = {
  Franklin: "Franklin County School District",
  Hart: "Hart County School District",
  Stephens: "Stephens County School District",
  Madison: "Madison County School District",
  Jackson: "Jackson County School District",
  Hall: "Hall County School District",
  Gwinnett: "Gwinnett County Public Schools",
  Barrow: "Barrow County School System",
  // Statewide sample areas (each checked against the district's own website).
  Fulton: "Fulton County Schools",
  DeKalb: "DeKalb County School District",
  Cobb: "Cobb County School District",
  Clarke: "Clarke County School District",
  Richmond: "Richmond County School System",
  Chatham: "Savannah-Chatham County Public School System",
  Bibb: "Bibb County School District",
  Muscogee: "Muscogee County School District",
  Floyd: "Floyd County Schools",
  Whitfield: "Whitfield County Schools",
  Fannin: "Fannin County School System",
  Houston: "Houston County Schools",
  Baldwin: "Baldwin County School District",
  Bulloch: "Bulloch County Schools",
  Glynn: "Glynn County Schools",
  Dougherty: "Dougherty County School System",
  Lowndes: "Lowndes County Schools",
  Thomas: "Thomas County Schools",
};

export const AREAS: SeedArea[] = [
  // ── Franklin County ──────────────────────────────────────────────────────
  {
    slug: "royston",
    name: "Royston",
    kind: "town",
    city: "Royston",
    zip: "30662",
    center: [34.28706, -83.11015],
    ppsf: [140, 200],
    sqft: [1000, 2800],
    years: [1920, 2025],
    lot: [9000, 30000],
    acres: [3, 60],
    perAcre: [7000, 16000],
    mix: { single_family: 7, land: 2, farm_ranch: 1, manufactured: 1, commercial: 1 },
    vibe: "a few minutes from Victoria Bryant State Park and the Ty Cobb Museum",
    weight: 9,
    ourWeight: 14,
  },
  {
    slug: "franklin-springs",
    name: "Franklin Springs",
    kind: "town",
    city: "Franklin Springs",
    zip: "30639",
    center: [34.28483, -83.14432],
    ppsf: [135, 190],
    sqft: [1000, 2600],
    years: [1950, 2025],
    lot: [10000, 40000],
    acres: [2, 40],
    perAcre: [7000, 15000],
    mix: { single_family: 7, land: 2, manufactured: 1, farm_ranch: 0.5 },
    vibe: "close to Victoria Bryant State Park and its Highland Walk golf course",
    weight: 4,
    ourWeight: 5,
  },
  {
    slug: "canon",
    name: "Canon",
    kind: "town",
    city: "Canon",
    zip: "30520",
    center: [34.34622, -83.10988],
    ppsf: [120, 175],
    sqft: [900, 2400],
    years: [1910, 2024],
    lot: [10000, 45000],
    acres: [3, 50],
    perAcre: [6500, 13000],
    mix: { single_family: 5, land: 3, farm_ranch: 1, manufactured: 1 },
    vibe: "with GA 17 running through town and open farm country all around",
    weight: 3,
    ourWeight: 4,
  },
  {
    slug: "lavonia",
    name: "Lavonia",
    kind: "town",
    city: "Lavonia",
    zip: "30553",
    center: [34.43594, -83.10682],
    ppsf: [140, 215],
    sqft: [1000, 3000],
    years: [1920, 2025],
    lot: [9000, 35000],
    acres: [2, 40],
    perAcre: [8000, 18000],
    mix: { single_family: 7, land: 2, commercial: 1, townhouse: 0.5, manufactured: 0.5 },
    vibe: "right off I-85 and a short drive from Tugaloo State Park",
    weight: 6,
    ourWeight: 6,
  },
  {
    slug: "carnesville",
    name: "Carnesville",
    kind: "town",
    city: "Carnesville",
    zip: "30521",
    center: [34.36983, -83.23516],
    ppsf: [125, 185],
    sqft: [1000, 2800],
    years: [1930, 2025],
    lot: [15000, 60000],
    acres: [5, 220],
    perAcre: [6500, 15000],
    mix: { single_family: 4, land: 4, farm_ranch: 2, manufactured: 1, commercial: 0.6 },
    vibe: "near the 1906 Franklin County Courthouse, with I-85 just outside town",
    weight: 6,
    ourWeight: 7,
  },

  // ── Lake Hartwell & Hart County ──────────────────────────────────────────
  {
    slug: "hartwell",
    name: "Hartwell",
    kind: "town",
    city: "Hartwell",
    zip: "30643",
    center: [34.35289, -82.93209],
    ppsf: [145, 225],
    sqft: [1000, 3200],
    years: [1900, 2025],
    lot: [9000, 35000],
    acres: [2, 50],
    perAcre: [8000, 20000],
    mix: { single_family: 7, land: 2, commercial: 1, multi_family: 0.4, manufactured: 0.5 },
    vibe: "near the historic downtown square and Hartwell Lakeside Park",
    weight: 6,
    ourWeight: 7,
  },
  {
    slug: "lake-hartwell",
    name: "Lake Hartwell",
    kind: "lake",
    city: "Hartwell",
    zip: "30643",
    center: [34.4, -82.9],
    lakeBounds: { west: -83.2826, south: 34.3376, east: -82.8019, north: 34.6496 },
    ppsf: [240, 420],
    sqft: [1400, 4200],
    years: [1968, 2025],
    lot: [22000, 90000],
    acres: [0.7, 4],
    perAcre: [70000, 170000],
    mix: { single_family: 8, land: 3 },
    waterfrontChance: 0.6,
    poolChance: 0.1,
    basementChance: 0.5,
    vibe: "with 962 miles of shoreline to explore",
    weight: 11,
    ourWeight: 10,
  },

  // ── Stephens County ──────────────────────────────────────────────────────
  {
    slug: "toccoa",
    name: "Toccoa",
    kind: "town",
    city: "Toccoa",
    zip: "30577",
    center: [34.57733, -83.33239],
    ppsf: [130, 200],
    sqft: [900, 3000],
    years: [1910, 2025],
    lot: [8000, 30000],
    acres: [2, 60],
    perAcre: [7000, 16000],
    mix: {
      single_family: 7,
      land: 2,
      commercial: 1,
      multi_family: 0.5,
      manufactured: 0.5,
      farm_ranch: 0.5,
    },
    district: "Stephens County School District",
    mountainViewChance: 0.2,
    vibe: "close to Toccoa Falls and the Currahee Military Museum",
    weight: 6,
    ourWeight: 4,
  },
  {
    slug: "martin",
    name: "Martin",
    kind: "town",
    city: "Martin",
    zip: "30557",
    center: [34.48705, -83.18488],
    ppsf: [125, 185],
    sqft: [900, 2400],
    years: [1940, 2024],
    lot: [15000, 50000],
    acres: [3, 40],
    perAcre: [7000, 15000],
    mix: { single_family: 5, land: 2, manufactured: 1, farm_ranch: 0.5 },
    vibe: "on GA 17, a short drive from Tugaloo State Park",
    weight: 3,
    ourWeight: 4,
  },

  // ── Madison & Jackson Counties ───────────────────────────────────────────
  {
    slug: "danielsville",
    name: "Danielsville",
    kind: "town",
    city: "Danielsville",
    zip: "30633",
    center: [34.12428, -83.22127],
    ppsf: [140, 200],
    sqft: [1000, 2800],
    years: [1930, 2025],
    lot: [15000, 60000],
    acres: [4, 80],
    perAcre: [9000, 18000],
    mix: { single_family: 5, land: 3, farm_ranch: 1.5, manufactured: 1, commercial: 0.4 },
    vibe: "near the historic Madison County Courthouse on the town square",
    weight: 4,
    ourWeight: 5,
  },
  {
    slug: "comer",
    name: "Comer",
    kind: "town",
    city: "Comer",
    zip: "30629",
    center: [34.06373, -83.12543],
    ppsf: [135, 195],
    sqft: [1000, 2700],
    years: [1900, 2024],
    lot: [15000, 50000],
    acres: [4, 80],
    perAcre: [8500, 17000],
    mix: { single_family: 5, land: 3, farm_ranch: 1.5, manufactured: 0.8 },
    vibe: "a few miles from Watson Mill Bridge State Park and its 1885 covered bridge",
    weight: 3,
    ourWeight: 4,
  },
  {
    slug: "commerce",
    name: "Commerce",
    kind: "town",
    city: "Commerce",
    zip: "30529",
    center: [34.204, -83.45711],
    ppsf: [165, 225],
    sqft: [1200, 3000],
    years: [1940, 2026],
    lot: [8000, 25000],
    acres: [2, 40],
    perAcre: [15000, 35000],
    mix: { single_family: 7, townhouse: 1, land: 1.5, commercial: 1.5 },
    district: "Commerce City School District",
    hoaChance: 0.45,
    vibe: "near the historic downtown and I-85",
    weight: 6,
    ourWeight: 3,
  },
  {
    slug: "jefferson",
    name: "Jefferson",
    kind: "town",
    city: "Jefferson",
    zip: "30549",
    center: [34.11706, -83.57239],
    townReachKm: 9,
    ppsf: [175, 240],
    sqft: [1500, 3600],
    years: [1950, 2026],
    lot: [9000, 26000],
    acres: [2, 40],
    perAcre: [20000, 45000],
    mix: { single_family: 8, townhouse: 1, land: 1.5, commercial: 1 },
    district: "Jefferson City School District",
    hoaChance: 0.55,
    vibe: "near the 1879 courthouse and the Crawford W. Long Museum",
    weight: 6,
    ourWeight: 2,
  },
  {
    slug: "braselton",
    name: "Braselton",
    kind: "town",
    city: "Braselton",
    zip: "30517",
    center: [34.10928, -83.76268],
    townReachKm: 10.5,
    ppsf: [195, 290],
    sqft: [1600, 4800],
    years: [1992, 2026],
    lot: [9000, 30000],
    acres: [2, 25],
    perAcre: [35000, 80000],
    mix: { single_family: 8, townhouse: 2, land: 1, commercial: 0.8 },
    district: "Jackson County School District",
    poolChance: 0.2,
    basementChance: 0.35,
    hoaChance: 0.8,
    vibe: "close to Château Élan's vineyards and golf",
    weight: 6,
    ourWeight: 1,
  },

  // ── Hall & Gwinnett ──────────────────────────────────────────────────────
  {
    slug: "gainesville",
    name: "Gainesville",
    kind: "town",
    city: "Gainesville",
    zip: "30501",
    center: [34.29789, -83.82407],
    townReachKm: 8.5,
    ppsf: [185, 285],
    sqft: [1000, 3800],
    years: [1925, 2026],
    lot: [8000, 26000],
    acres: [2, 25],
    perAcre: [25000, 60000],
    mix: {
      single_family: 7,
      townhouse: 1.5,
      condo: 1,
      commercial: 1.2,
      multi_family: 0.6,
      land: 1,
    },
    district: "Gainesville City School District",
    basementChance: 0.35,
    hoaChance: 0.4,
    vibe: "minutes from the historic downtown square and Brenau University",
    weight: 8,
    ourWeight: 2,
  },
  {
    slug: "flowery-branch",
    name: "Flowery Branch",
    kind: "town",
    city: "Flowery Branch",
    zip: "30542",
    center: [34.18511, -83.92518],
    ppsf: [190, 275],
    sqft: [1400, 4000],
    years: [1985, 2026],
    lot: [8000, 26000],
    acres: [2, 20],
    perAcre: [35000, 75000],
    mix: { single_family: 8, townhouse: 2, land: 1 },
    basementChance: 0.45,
    hoaChance: 0.7,
    vibe: "near the historic train depot and I-985",
    weight: 5,
    ourWeight: 1,
  },
  {
    slug: "lake-lanier",
    name: "Lake Lanier",
    kind: "lake",
    city: "Gainesville",
    zip: "30506",
    center: [34.19, -83.98],
    lakeBounds: { west: -84.1211, south: 34.1463, east: -83.6892, north: 34.4399 },
    ppsf: [300, 520],
    sqft: [1800, 5200],
    years: [1975, 2026],
    lot: [20000, 70000],
    acres: [0.8, 3],
    perAcre: [180000, 380000],
    mix: { single_family: 8, land: 2, condo: 1 },
    waterfrontChance: 0.55,
    poolChance: 0.2,
    basementChance: 0.65,
    vibe: "with marinas and Corps of Engineers parks all around the lake",
    weight: 8,
    ourWeight: 1,
  },
  {
    slug: "buford",
    name: "Buford",
    kind: "town",
    city: "Buford",
    zip: "30518",
    center: [34.12066, -84.00436],
    ppsf: [205, 300],
    sqft: [1300, 4200],
    years: [1940, 2026],
    lot: [8000, 26000],
    acres: [2, 15],
    perAcre: [50000, 110000],
    mix: { single_family: 8, townhouse: 2, commercial: 1, land: 0.6 },
    district: "Buford City School District",
    basementChance: 0.45,
    hoaChance: 0.6,
    vibe: "near the Tannery Row studios and the Mall of Georgia",
    weight: 6,
    ourWeight: 1,
  },
  {
    slug: "dacula",
    name: "Dacula",
    kind: "town",
    city: "Dacula",
    zip: "30019",
    center: [33.98872, -83.89796],
    ppsf: [190, 265],
    sqft: [1500, 4200],
    years: [1985, 2026],
    lot: [9000, 30000],
    acres: [2, 20],
    perAcre: [40000, 90000],
    mix: { single_family: 9, townhouse: 1, land: 1 },
    basementChance: 0.4,
    hoaChance: 0.7,
    vibe: "close to Little Mulberry Park's trails and lakes",
    weight: 5,
    ourWeight: 1,
  },
];

/** Area codes by region, for the sample listing-agent phones. */
const INNER_ATLANTA = ["404", "678", "470"];
const OUTER_ATLANTA = ["770", "678", "470"];
const COASTAL = ["912"];
const MIDDLE = ["478"];
const SOUTHWEST = ["229"];

/**
 * The statewide sample feed: listings from other (fictional) brokerages
 * across Georgia, so search, maps and the places index have something to show
 * beyond the firm's own market. `weight` is each area's exact listing count;
 * `ourWeight` is always 0, because Adams Realty's own listings stay in
 * Northeast Georgia. Centers are USGS GNIS points; price bands are for demo
 * plausibility only, not market facts. Areas without a `district` are served
 * by their county's district (COUNTY_DISTRICTS).
 */
export const STATEWIDE_AREAS: SeedArea[] = [
  // ── Metro Atlanta ─────────────────────────────────────────────────────────
  {
    slug: "atlanta",
    name: "Atlanta",
    kind: "town",
    city: "Atlanta",
    zip: "30303",
    center: [33.749, -84.38799],
    urban: true,
    areaCodes: INNER_ATLANTA,
    ppsf: [240, 420],
    sqft: [850, 4200],
    years: [1900, 2026],
    lot: [4000, 15000],
    acres: [0.3, 2],
    perAcre: [350000, 900000],
    mix: {
      single_family: 6,
      condo: 3,
      townhouse: 2,
      multi_family: 0.6,
      commercial: 0.5,
      land: 0.4,
    },
    district: "Atlanta Public Schools",
    basementChance: 0.3,
    hoaChance: 0.3,
    vibe: "with MARTA rail and the BeltLine's trails and parks running through the city",
    weight: 30,
    ourWeight: 0,
  },
  {
    slug: "virginia-highland",
    name: "Virginia-Highland",
    kind: "neighborhood",
    city: "Atlanta",
    zip: "30306",
    center: [33.78233, -84.35132],
    urban: true,
    areaCodes: INNER_ATLANTA,
    ppsf: [380, 560],
    sqft: [1200, 3600],
    years: [1915, 2026],
    lot: [5000, 14000],
    acres: [0.2, 1],
    perAcre: [800000, 1500000],
    mix: { single_family: 7, condo: 1.5, townhouse: 1 },
    district: "Atlanta Public Schools",
    basementChance: 0.35,
    hoaChance: 0.1,
    vibe: "near the shops on North Highland Avenue and the paths of Piedmont Park",
    weight: 8,
    ourWeight: 0,
  },
  {
    slug: "decatur",
    name: "Decatur",
    kind: "town",
    city: "Decatur",
    zip: "30030",
    center: [33.77483, -84.29632],
    urban: true,
    areaCodes: INNER_ATLANTA,
    ppsf: [320, 480],
    sqft: [1100, 3800],
    years: [1910, 2026],
    lot: [6000, 18000],
    acres: [0.2, 1.5],
    perAcre: [600000, 1200000],
    mix: { single_family: 7, townhouse: 2, condo: 1.5 },
    district: "City Schools of Decatur",
    basementChance: 0.3,
    hoaChance: 0.2,
    vibe: "near the historic courthouse square and the Decatur MARTA station",
    weight: 22,
    ourWeight: 0,
  },
  {
    slug: "marietta",
    name: "Marietta",
    kind: "town",
    city: "Marietta",
    zip: "30060",
    center: [33.95261, -84.54994],
    urban: true,
    areaCodes: OUTER_ATLANTA,
    ppsf: [200, 310],
    sqft: [1200, 4200],
    years: [1900, 2026],
    lot: [8000, 26000],
    acres: [0.5, 3],
    perAcre: [150000, 400000],
    mix: { single_family: 8, townhouse: 2, condo: 0.6, commercial: 0.5, land: 0.4 },
    district: "Marietta City Schools",
    basementChance: 0.4,
    hoaChance: 0.5,
    vibe: "near Glover Park on the historic Marietta Square",
    weight: 14,
    ourWeight: 0,
  },
  {
    slug: "alpharetta",
    name: "Alpharetta",
    kind: "town",
    city: "Alpharetta",
    zip: "30009",
    center: [34.07538, -84.29409],
    urban: true,
    areaCodes: OUTER_ATLANTA,
    ppsf: [230, 340],
    sqft: [1600, 5500],
    years: [1975, 2026],
    lot: [9000, 30000],
    acres: [0.5, 3],
    perAcre: [200000, 500000],
    mix: { single_family: 8, townhouse: 2.5, condo: 0.8 },
    district: "Fulton County Schools",
    poolChance: 0.2,
    basementChance: 0.55,
    hoaChance: 0.85,
    vibe: "close to the Big Creek Greenway and the historic downtown",
    weight: 12,
    ourWeight: 0,
  },

  // ── Regional cities ───────────────────────────────────────────────────────
  {
    slug: "athens",
    name: "Athens",
    kind: "town",
    city: "Athens",
    zip: "30601",
    center: [33.96095, -83.37794],
    ppsf: [190, 300],
    sqft: [900, 3400],
    years: [1900, 2026],
    lot: [8000, 30000],
    acres: [2, 40],
    perAcre: [15000, 40000],
    mix: {
      single_family: 7,
      condo: 2,
      townhouse: 1.5,
      multi_family: 0.8,
      land: 1,
      commercial: 0.6,
    },
    district: "Clarke County School District",
    hoaChance: 0.3,
    vibe: "close to downtown and the University of Georgia's historic North Campus",
    weight: 14,
    ourWeight: 0,
  },
  {
    slug: "augusta",
    name: "Augusta",
    kind: "town",
    city: "Augusta",
    zip: "30901",
    center: [33.47098, -81.97484],
    ppsf: [115, 195],
    sqft: [1000, 3400],
    years: [1900, 2026],
    lot: [8000, 30000],
    acres: [2, 50],
    perAcre: [8000, 20000],
    mix: { single_family: 8, townhouse: 1, multi_family: 0.6, land: 1, commercial: 0.8 },
    district: "Richmond County School System",
    vibe: "near the Augusta Canal and the downtown Riverwalk",
    weight: 14,
    ourWeight: 0,
  },
  {
    slug: "savannah",
    name: "Savannah",
    kind: "town",
    city: "Savannah",
    zip: "31401",
    center: [32.08355, -81.09984],
    urban: true,
    areaCodes: COASTAL,
    ppsf: [220, 420],
    sqft: [900, 3600],
    years: [1880, 2026],
    lot: [3000, 15000],
    acres: [0.3, 2],
    perAcre: [200000, 600000],
    mix: {
      single_family: 6,
      condo: 2.5,
      townhouse: 2,
      multi_family: 0.6,
      commercial: 0.6,
      land: 0.4,
    },
    district: "Savannah-Chatham County Public School System",
    hoaChance: 0.3,
    vibe: "a short drive from the Historic District's squares and River Street",
    weight: 16,
    ourWeight: 0,
  },
  {
    slug: "macon",
    name: "Macon",
    kind: "town",
    city: "Macon",
    zip: "31201",
    center: [32.8407, -83.63241],
    areaCodes: MIDDLE,
    ppsf: [100, 180],
    sqft: [1000, 3200],
    years: [1900, 2026],
    lot: [8000, 35000],
    acres: [2, 60],
    perAcre: [5000, 12000],
    mix: { single_family: 8, land: 1.2, commercial: 0.8, multi_family: 0.5, manufactured: 0.5 },
    district: "Bibb County School District",
    vibe: "near Ocmulgee Mounds National Historical Park and the historic downtown",
    weight: 12,
    ourWeight: 0,
  },
  {
    slug: "columbus",
    name: "Columbus",
    kind: "town",
    city: "Columbus",
    zip: "31901",
    center: [32.46098, -84.98771],
    ppsf: [110, 190],
    sqft: [1000, 3400],
    years: [1900, 2026],
    lot: [8000, 30000],
    acres: [2, 50],
    perAcre: [6000, 15000],
    mix: { single_family: 8, townhouse: 1, land: 1, commercial: 0.8, condo: 0.4 },
    district: "Muscogee County School District",
    vibe: "near the Chattahoochee RiverWalk and the National Infantry Museum",
    weight: 12,
    ourWeight: 0,
  },

  // ── North Georgia ─────────────────────────────────────────────────────────
  {
    slug: "rome",
    name: "Rome",
    kind: "town",
    city: "Rome",
    zip: "30161",
    center: [34.25704, -85.16468],
    ppsf: [125, 205],
    sqft: [1000, 3200],
    years: [1900, 2026],
    lot: [9000, 35000],
    acres: [3, 80],
    perAcre: [5000, 12000],
    mix: { single_family: 7, land: 2, farm_ranch: 0.6, commercial: 0.8, manufactured: 0.6 },
    district: "Rome City Schools",
    vibe: "near the historic Broad Street downtown, where the Etowah and Oostanaula rivers meet",
    weight: 8,
    ourWeight: 0,
  },
  {
    slug: "dalton",
    name: "Dalton",
    kind: "town",
    city: "Dalton",
    zip: "30720",
    center: [34.76981, -84.97023],
    mountainViewChance: 0.15,
    ppsf: [125, 195],
    sqft: [1000, 3200],
    years: [1920, 2026],
    lot: [9000, 35000],
    acres: [2, 50],
    perAcre: [7000, 16000],
    mix: { single_family: 7, land: 1.5, commercial: 1, manufactured: 0.8 },
    district: "Dalton Public Schools",
    vibe: "near the historic downtown of the city known as the Carpet Capital of the World",
    weight: 6,
    ourWeight: 0,
  },
  {
    slug: "blue-ridge",
    name: "Blue Ridge",
    kind: "town",
    city: "Blue Ridge",
    zip: "30513",
    center: [34.86398, -84.32409],
    mountainViewChance: 0.5,
    ppsf: [260, 460],
    sqft: [900, 3200],
    years: [1930, 2026],
    lot: [10000, 45000],
    acres: [1, 25],
    perAcre: [15000, 50000],
    mix: { single_family: 8, land: 3, commercial: 0.5 },
    basementChance: 0.55,
    vibe: "near the Blue Ridge Scenic Railway depot and Lake Blue Ridge",
    weight: 10,
    ourWeight: 0,
  },

  // ── Middle and south Georgia ──────────────────────────────────────────────
  {
    slug: "warner-robins",
    name: "Warner Robins",
    kind: "town",
    city: "Warner Robins",
    zip: "31093",
    center: [32.62098, -83.59991],
    urban: true,
    areaCodes: MIDDLE,
    ppsf: [130, 195],
    sqft: [1200, 3400],
    years: [1960, 2026],
    lot: [9000, 26000],
    acres: [1, 5],
    perAcre: [20000, 50000],
    mix: { single_family: 9, townhouse: 1, land: 0.8, commercial: 0.6 },
    district: "Houston County Schools",
    hoaChance: 0.4,
    vibe: "near the Museum of Aviation at Robins Air Force Base",
    weight: 8,
    ourWeight: 0,
  },
  {
    slug: "milledgeville",
    name: "Milledgeville",
    kind: "town",
    city: "Milledgeville",
    zip: "31061",
    center: [33.08015, -83.2321],
    areaCodes: MIDDLE,
    ppsf: [110, 190],
    sqft: [1000, 3200],
    years: [1900, 2026],
    lot: [10000, 40000],
    acres: [3, 80],
    perAcre: [4000, 9000],
    mix: { single_family: 7, land: 1.5, farm_ranch: 0.4, commercial: 0.6, manufactured: 0.6 },
    vibe: "near the Old Governor's Mansion and Georgia College's campus",
    weight: 6,
    ourWeight: 0,
  },
  {
    slug: "statesboro",
    name: "Statesboro",
    kind: "town",
    city: "Statesboro",
    zip: "30458",
    center: [32.44879, -81.78317],
    areaCodes: COASTAL,
    ppsf: [130, 200],
    sqft: [1000, 3200],
    years: [1950, 2026],
    lot: [10000, 35000],
    acres: [3, 80],
    perAcre: [4000, 9000],
    mix: {
      single_family: 7,
      townhouse: 1.2,
      condo: 0.6,
      land: 1.5,
      farm_ranch: 0.6,
      manufactured: 0.6,
    },
    vibe: "near the historic downtown and Georgia Southern University",
    weight: 6,
    ourWeight: 0,
  },
  {
    slug: "brunswick",
    name: "Brunswick",
    kind: "town",
    city: "Brunswick",
    zip: "31520",
    center: [31.14996, -81.49149],
    areaCodes: COASTAL,
    ppsf: [150, 260],
    sqft: [900, 3000],
    years: [1890, 2026],
    lot: [6000, 25000],
    acres: [1, 20],
    perAcre: [10000, 30000],
    mix: { single_family: 7, land: 1.5, commercial: 0.8, townhouse: 0.6, multi_family: 0.5 },
    vibe: "near the squares of the Old Town Brunswick historic district",
    weight: 8,
    ourWeight: 0,
  },
  {
    slug: "albany",
    name: "Albany",
    kind: "town",
    city: "Albany",
    zip: "31701",
    center: [31.57851, -84.15575],
    areaCodes: SOUTHWEST,
    ppsf: [85, 150],
    sqft: [1000, 3000],
    years: [1920, 2026],
    lot: [9000, 35000],
    acres: [5, 200],
    perAcre: [3500, 7000],
    mix: { single_family: 7, land: 2, farm_ranch: 1, commercial: 0.8, manufactured: 0.8 },
    vibe: "near the Flint RiverQuarium and Chehaw Park",
    weight: 6,
    ourWeight: 0,
  },
  {
    slug: "valdosta",
    name: "Valdosta",
    kind: "town",
    city: "Valdosta",
    zip: "31601",
    center: [30.83271, -83.27849],
    areaCodes: SOUTHWEST,
    ppsf: [110, 175],
    sqft: [1000, 3200],
    years: [1920, 2026],
    lot: [9000, 35000],
    acres: [3, 80],
    perAcre: [4000, 9000],
    mix: { single_family: 8, land: 1.5, farm_ranch: 0.6, commercial: 0.6, manufactured: 0.6 },
    district: "Valdosta City Schools",
    vibe: "near Valdosta State University and the historic downtown",
    weight: 8,
    ourWeight: 0,
  },
  {
    slug: "thomasville",
    name: "Thomasville",
    kind: "town",
    city: "Thomasville",
    zip: "31792",
    center: [30.83659, -83.97878],
    areaCodes: SOUTHWEST,
    ppsf: [130, 220],
    sqft: [1000, 3400],
    years: [1890, 2026],
    lot: [10000, 40000],
    acres: [5, 250],
    perAcre: [4000, 9000],
    mix: { single_family: 7, land: 2, farm_ranch: 1, commercial: 0.6 },
    district: "Thomasville City Schools",
    vibe: "near the historic downtown and the city's famous Big Oak",
    weight: 6,
    ourWeight: 0,
  },
];

/**
 * Middle Georgia's two big lakes, so a lake search works statewide and not
 * just in the firm's market. Seeded after STATEWIDE_AREAS (from the same
 * PRNG, continuing), so adding them left every other statewide listing as it
 * was. Pools are built by scripts/dev/gen-seed-sites.ts: waterfront on the
 * mainland 30–140 m from the NHD shoreline, near 300 m–2.5 km from it; each
 * row carries its own city and ZIP (the ZIP's mailing city), since each lake
 * spans several towns and counties. `city`/`zip` below are only defaults.
 * Price bands are for demo plausibility only, not market facts.
 */
export const STATEWIDE_LAKES: SeedArea[] = [
  {
    slug: "lake-sinclair",
    name: "Lake Sinclair",
    kind: "lake",
    city: "Milledgeville",
    zip: "31061",
    center: [33.21, -83.28],
    lakeBounds: { west: -83.433, south: 33.1388, east: -83.1017, north: 33.3511 },
    areaCodes: MIDDLE,
    ppsf: [170, 300],
    sqft: [1300, 3600],
    years: [1960, 2026],
    lot: [18000, 60000],
    acres: [0.5, 2.5],
    perAcre: [60000, 160000],
    mix: { single_family: 8, land: 2 },
    waterfrontChance: 0.6,
    basementChance: 0.2,
    vibe: "with coves, marinas and good fishing all along the shore",
    weight: 5,
    ourWeight: 0,
  },
  {
    slug: "lake-oconee",
    name: "Lake Oconee",
    kind: "lake",
    city: "Greensboro",
    zip: "30642",
    center: [33.45, -83.3],
    lakeBounds: { west: -83.3581, south: 33.3437, east: -83.1389, north: 33.6654 },
    areaCodes: MIDDLE,
    ppsf: [260, 460],
    sqft: [1800, 5200],
    years: [1980, 2026],
    lot: [20000, 70000],
    acres: [0.7, 3],
    perAcre: [150000, 380000],
    mix: { single_family: 8, land: 2 },
    waterfrontChance: 0.6,
    poolChance: 0.25,
    basementChance: 0.4,
    hoaChance: 0.6,
    vibe: "with golf courses, marinas and quiet coves along the shore",
    weight: 7,
    ourWeight: 0,
  },
];

/** Made-up street names. Residential, rural and commercial streets draw from these. */
export const STREETS = [
  "Dogwood",
  "Magnolia",
  "Azalea",
  "Camellia",
  "Loblolly",
  "Sweetgum",
  "Hickory Ridge",
  "Willow Oak",
  "Red Clay",
  "Pecan Grove",
  "Oakleaf",
  "Laurel Brook",
  "Mulberry",
  "Sassafras",
  "Whippoorwill",
  "Cherokee Rose",
  "Brown Thrasher",
  "Tupelo",
  "Honeysuckle",
  "Chinquapin",
  "Bramblewood",
  "Stone Mill",
  "Foxhollow",
  "Creekview",
  "Muscadine",
  "Cedar Crest",
  "Quail Run",
  "Persimmon",
  "Wild Turkey",
  "Blackberry",
];
export const SUFFIXES = ["St", "Ave", "Dr", "Ln", "Way", "Trl", "Ct", "Pl", "Cir"];
export const RURAL_SUFFIXES = ["Rd", "Rd", "Farm Rd", "Creek Rd", "Ridge Rd", "Mill Rd"];
export const LAKE_SUFFIXES = ["Point Rd", "Cove Dr", "Shores Dr", "Landing Rd", "Bay Ct"];
export const COMMERCIAL_SUFFIXES = ["Business Pkwy", "Trade Center Dr", "Industrial Blvd"];
export const CONDO_STREETS = ["Harbor Pointe Dr", "Lakeshore Commons", "Mill Village Way"];

const u = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1600&q=80`;

export const EXTERIORS = [
  "photo-1600596542815-ffad4c1539a9",
  "photo-1600585154340-be6161a56a0c",
  "photo-1512917774080-9991f1c4c750",
  "photo-1564013799919-ab600027ffc6",
  "photo-1568605114967-8130f3a36994",
  "photo-1570129477492-45c003edd2be",
  "photo-1580587771525-78b9dba3b914",
  "photo-1613490493576-7fde63acd811",
  "photo-1605276374104-dee2a0ed3cd6",
  "photo-1583608205776-bfd35f0d9f83",
  "photo-1576941089067-2de3c901e126",
  "photo-1598228723793-52759bba239c",
  "photo-1523217582562-09d0def993a6",
  "photo-1558036117-15d82a90b9b1",
  "photo-1572120360610-d971b9d7767c",
  "photo-1600047509807-ba8f99d2cdde",
  "photo-1600566753190-17f0baa2a6c3",
  "photo-1602343168117-bb8ffe3e2e9f",
].map(u);

export const CONDO_EXTERIORS = [
  "photo-1545324418-cc1a3fa10c00",
  "photo-1460317442991-0ec209397118",
  "photo-1512918728675-ed5a9ecdebfd",
].map(u);

/** Open land: pasture, hardwoods and pines. */
export const LAND_PHOTOS: Array<{ url: string; caption: string }> = [
  ["photo-1500382017468-9049fed747ef", "Open pasture"],
  ["photo-1472214103451-9374bd1c798e", "Rolling fields"],
  ["photo-1441974231531-c6227db76b6e", "Hardwoods"],
  ["photo-1448375240586-882707db888b", "Timber"],
  ["photo-1470071459604-3b5ec3a7fe05", "Morning over the property"],
].map(([id, caption]) => ({ url: u(id), caption }));

export const LAKE_PHOTOS: Array<{ url: string; caption: string }> = [
  ["photo-1501785888041-af3ef285b470", "Lake view"],
  ["photo-1439066615861-d1af74d74000", "The lake"],
  ["photo-1506744038136-46273834b3fb", "Sunset over the water"],
].map(([id, caption]) => ({ url: u(id), caption }));

export const COMMERCIAL_PHOTOS: Array<{ url: string; caption: string }> = [
  ["photo-1486406146926-c627a92ad1ab", "Exterior"],
  ["photo-1441986300917-64674bd600d8", "Retail space"],
  ["photo-1497366216548-37526070297c", "Office space"],
  ["photo-1497366811353-6870744d04b2", "Office"],
  ["photo-1555396273-367ea4eb4db5", "Dining room"],
  ["photo-1586528116311-ad8dd3c8310d", "Warehouse"],
].map(([id, caption]) => ({ url: u(id), caption }));

export const INTERIORS: Array<{ url: string; caption: string }> = [
  ["photo-1600607687939-ce8a6c25118c", "Living room"],
  ["photo-1600210492486-724fe5c67fb0", "Living room"],
  ["photo-1600566753086-00f18fb6b3ea", "Kitchen"],
  ["photo-1600585154526-990dced4db0d", "Dining"],
  ["photo-1600607687644-c7171b42498b", "Kitchen"],
  ["photo-1600566752355-35792bedcfea", "Primary bath"],
  ["photo-1484154218962-a197022b5858", "Kitchen"],
  ["photo-1556909114-f6e7ad7d3136", "Kitchen"],
  ["photo-1502672260266-1c1ef2d93688", "Living room"],
  ["photo-1522708323590-d24dbb6b0267", "Open living"],
  ["photo-1493809842364-78817add7ffb", "Living room"],
  ["photo-1560448204-e02f11c3d0e2", "Living room"],
  ["photo-1560185893-a55cbc8c57e8", "Den"],
  ["photo-1505691938895-1758d7feb511", "Primary bedroom"],
  ["photo-1540518614846-7eded433c457", "Bedroom"],
  ["photo-1552321554-5fefe8c9ef14", "Bathroom"],
  ["photo-1584622650111-993a426fbf0a", "Bathroom"],
  ["photo-1600573472550-8090b5e0745e", "Great room"],
  ["photo-1616594039964-ae9021a400a0", "Living room"],
  ["photo-1618221195710-dd6b41faaea6", "Sitting room"],
  ["photo-1586023492125-27b2c045efd7", "Living room"],
].map(([id, caption]) => ({ url: u(id), caption }));

const photo = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=600&h=600&q=80`;

/**
 * The team. Index 0 is the broker and the admin login; indexes 1 and 2 get the
 * sample agent logins (daniel@, priya@) that tests and docs use.
 */
export const AGENTS: Array<{
  name: string;
  title: string;
  /** null = initials avatar. */
  photoUrl: string | null;
  phone: string;
  email: string;
  mlsAgentId: string;
  /** null = not shown. */
  years: number | null;
  specialties: string[];
  languages: string[];
  /** Area guide names or "<Name> County"; both match guides (src/lib/areas/match.ts). */
  areas: string[];
  bio: string;
  /** Real person (true) or fictional sample profile (false). */
  real: boolean;
}> = [
  {
    // REAL: Andrea Anderegg, broker. Name, title, brokerage, direct phone, MLS
    // agent ID, specialties and counties come from her public Georgia MLS and
    // Homes.com profiles; the headshot and email were provided by Adams Realty.
    // Don't add a bio, years or awards she hasn't provided; the bio below is
    // true by construction.
    name: "Andrea Anderegg",
    title: "Broker",
    photoUrl: "/team/andrea-anderegg.webp",
    phone: "(850) 572-3287",
    email: "contracts.adamsrealty@gmail.com",
    mlsAgentId: "ANDEREGGAA",
    years: null,
    specialties: [
      "First-time home buyers",
      "Investments",
      "Luxury homes",
      "Military families",
      "New construction",
      "Senior communities",
    ],
    languages: ["English"],
    areas: [
      "Franklin County",
      "Hart County",
      "Stephens County",
      "Madison County",
      "Jackson County",
      "Hall County",
      "Gwinnett County",
    ],
    bio: "Andrea Anderegg is the broker at Adams Realty, Inc. in Royston, working with buyers and sellers across Northeast Georgia. The firm handles houses, land, lake property, hunting land, farms and commercial property.",
    real: true,
  },
  // ── FICTIONAL SAMPLE AGENTS (demo only; stock photos; 555 phone numbers) ──
  {
    name: "Daniel Reyes",
    title: "Agent",
    photoUrl: photo("photo-1560250097-0b93528c311a"),
    phone: "(706) 555-0151",
    email: "daniel@adamsrealty.example",
    mlsAgentId: "SAMPLE-1",
    years: 11,
    specialties: ["Land & acreage", "Farms", "Hunting & timber land"],
    languages: ["English", "Spanish"],
    areas: ["Carnesville", "Danielsville", "Comer", "Canon"],
    bio: "Daniel walks every tract before he lists it: pasture, timber, hunting land and small farms, with the survey, road frontage and soil questions answered up front.",
    real: false,
  },
  {
    name: "Priya Natarajan",
    title: "Agent",
    photoUrl: photo("photo-1580489944761-15a19d654956"),
    phone: "(470) 555-0152",
    email: "priya@adamsrealty.example",
    mlsAgentId: "SAMPLE-2",
    years: 7,
    specialties: ["New construction", "First-time buyers", "Relocation"],
    languages: ["English", "Hindi"],
    areas: ["Commerce", "Jefferson", "Braselton", "Dacula"],
    bio: "Priya knows the new subdivisions along I-85 builder by builder, and she reads every contract addendum so her buyers don't have to guess.",
    real: false,
  },
  {
    name: "Caroline Pruitt",
    title: "Lake Specialist",
    photoUrl: photo("photo-1494790108377-be9c29b29330"),
    phone: "(706) 555-0153",
    email: "caroline@adamsrealty.example",
    mlsAgentId: "SAMPLE-3",
    years: 14,
    specialties: ["Lake property", "Waterfront", "Second homes"],
    languages: ["English"],
    areas: ["Lake Hartwell", "Hartwell", "Lavonia", "Martin"],
    bio: "Caroline checks dock permits, water depth and Corps of Engineers shoreline rules before anyone falls in love with a lake view.",
    real: false,
  },
  {
    name: "Marcus Bell",
    title: "Agent",
    photoUrl: photo("photo-1519085360753-af0119f7cbe7"),
    phone: "(762) 555-0154",
    email: "marcus@adamsrealty.example",
    mlsAgentId: "SAMPLE-4",
    years: 12,
    specialties: ["Commercial property", "Investment property", "Lake Lanier"],
    languages: ["English"],
    areas: ["Gainesville", "Flowery Branch", "Lake Lanier", "Buford"],
    bio: "Marcus handles storefronts, small warehouses and investment property, plus the occasional lake house for clients who'd rather be on the water.",
    real: false,
  },
];

/** Fictional brokerages for the sample MLS feed. */
export const OTHER_BROKERAGES = [
  "Sweetgum & Pine Realty",
  "Brown Thrasher Home Group",
  "Chinquapin Land Co.",
  "Muscadine Realty Partners",
  "Red Fox Ridge Realty",
  "Tupelo Lane Properties",
];

/** `{in}` becomes "in Royston", "on Lake Hartwell" or "near Lake Hartwell". */
export const OPENERS: Record<SeedPropertyType, string[]> = {
  single_family: [
    "Welcome home to this light-filled {style} {in}.",
    "Set on a {lotAdj} lot {in}, this {style} was made for everyday living and easy entertaining.",
    "Thoughtfully updated and move-in ready, this {style} sits {in}.",
    "This is the {style} you've been waiting for, {in}.",
  ],
  condo: [
    "Low-maintenance living with {view} from this {beds}-bedroom condo {in}.",
    "Lock up and go: a bright {beds}-bedroom condo {in} with {view}.",
  ],
  townhouse: [
    "A low-maintenance {style} townhome {in}.",
    "Bright, modern and easy to keep up, this townhome sits {in}.",
  ],
  multi_family: [
    "A well-kept duplex {in}: live in one side and rent the other.",
    "An income property {in} with separate entrances and meters.",
  ],
  manufactured: [
    "A move-in-ready manufactured home on a {lotAdj} lot {in}.",
    "Room to breathe: a manufactured home on {acres} acres {in}.",
  ],
  land: [
    "{acres} acres {in}, ready for your homesite, garden or getaway.",
    "Rolling land, mature hardwoods and room to breathe: {acres} acres {in}.",
  ],
  farm_ranch: [
    "A working farm on {acres} acres {in}, with a {style} farmhouse and room for animals.",
    "{acres} acres of pasture and woods {in}, with a comfortable {style} home.",
  ],
  commercial: [
    "A {sqft}-square-foot {subtype} building {in}, ready for your business.",
    "Well-located {subtype} space {in} with on-site parking.",
  ],
};

export const LAND_DETAILS = [
  "Mostly open pasture with a tree line along the back of the property.",
  "A mix of hardwoods and planted pines, with an interior road already cut.",
  "Paved road frontage, with power at the road.",
  "Gently rolling ground with several good building sites.",
  "Deer and turkey sign throughout, with room for a food plot and stand.",
  "A seasonal creek crosses the lower corner of the tract.",
];
export const TIMBER_DETAILS = [
  "Planted pines approaching harvest age, plus a mature hardwood bottom.",
  "Recreational tract with established trails and a cleared camp spot.",
];
export const LAKE_LOT_DETAILS = [
  "Gentle slope to the water through mature hardwoods.",
  "Wide lake views from the top of the lot, with a building site already cleared.",
  "Ask about dock eligibility under the Corps of Engineers shoreline plan.",
];
export const FARM_DETAILS = [
  "A center-aisle barn, fenced and cross-fenced pasture, and a run-in shed.",
  "Hay fields, a workshop and a covered equipment shed.",
  "Two stocked ponds, woods for hunting and pasture for cattle or horses.",
];
export const COMMERCIAL_DETAILS = [
  "Zoned commercial, with signage visible from the road.",
  "Open floor plan with private offices, restrooms and a rear loading door.",
  "Recent roof and HVAC, with a paved lot for customer parking.",
  "Flexible space that has served as retail, office and restaurant.",
];

export const STYLES = [
  "modern farmhouse",
  "brick ranch",
  "craftsman bungalow",
  "traditional two-story",
  "cottage",
  "split-level",
  "Cape Cod",
  "Victorian",
];

export const HIGHLIGHTS = [
  "The kitchen features quartz counters, a gas range and an oversized island.",
  "An open floor plan connects the kitchen, dining and living areas under vaulted ceilings.",
  "The primary suite is a true retreat with a spa-like bath and walk-in closet.",
  "Wide-plank oak floors run throughout the main level.",
  "Out back, a covered patio overlooks a private, level yard.",
  "A flexible bonus room works as an office, gym or guest space.",
  "Energy-efficient windows and a newer HVAC keep utility bills low.",
  "A screened porch off the kitchen makes the most of long Georgia evenings.",
  "The finished basement adds a media room, guest suite and walk-out patio.",
  "A detached workshop has power and room for the boat or the tractor.",
  "A rocking-chair front porch runs the width of the house.",
];
export const LAKE_HIGHLIGHTS = [
  "A covered dock with a boat lift sits at the end of a short path.",
  "Walls of windows frame the water from the great room and primary suite.",
  "The deck steps down to a fire pit with a view of the main channel.",
];

export const INTERIOR_FEATURES = [
  "Kitchen Island",
  "Walk-In Closets",
  "Quartz Counters",
  "Open Floorplan",
  "Vaulted Ceiling(s)",
  "Built-in Features",
  "Ceiling Fan(s)",
  "Double Vanity",
  "Pantry",
  "Recessed Lighting",
  "Primary Bedroom on Main",
];
export const EXTERIOR_FEATURES = [
  "Screened Porch",
  "Covered Patio",
  "Front Porch",
  "Deck",
  "Fenced Yard",
  "Storage Building",
  "Garden",
  "Rain Gutters",
];
export const APPLIANCES = [
  "Dishwasher",
  "Electric Range",
  "Gas Range",
  "Microwave",
  "Refrigerator",
  "Stainless Steel Appliance(s)",
  "Double Oven",
];
export const FLOORING = ["Hardwood", "Tile", "Carpet", "Vinyl"];
export const COMMUNITY = ["Clubhouse", "Pool", "Playground", "Sidewalks", "Street Lights"];

/**
 * Lake homes shaped like the real Georgia MLS feed: RESO SubdivisionName in
 * `neighborhood` and the lake only in WaterBodyName. Each proves one way the
 * location box finds a lake (src/lib/search/query.ts `locationCondition`):
 * - Lake Hartwell: the lake's full name in WaterBodyName.
 * - Lake Lanier: only the guide's alias "Lanier" in WaterBodyName, so just the
 *   area-guide match finds it for "Lake Lanier" (no word "lake" anywhere).
 * - Lake Sinclair: no area guide, so just `location_vector` finds it. It sits
 *   on a Lake Sinclair waterfront site (STATEWIDE_LAKES), like the others on
 *   their lakes'.
 * Prices are unique in the seed; e2e/statewide.spec.ts uses them.
 */
export const LAKE_FIXTURES = [
  {
    area: "lake-hartwell",
    query: "Lake Hartwell",
    street: "118 Cedar Cove Court",
    neighborhood: "Cedar Cove",
    waterBody: "Lake Hartwell",
    price: 612_345,
  },
  {
    area: "lake-lanier",
    query: "Lake Lanier",
    street: "412 Harbour Point Drive",
    neighborhood: "Harbour Point",
    waterBody: "Lanier",
    price: 734_567,
  },
  {
    area: "lake-sinclair",
    query: "Lake Sinclair",
    street: "27 Twin Oaks Trail",
    neighborhood: "Twin Oaks",
    waterBody: "Lake Sinclair",
    price: 456_789,
  },
] as const;
