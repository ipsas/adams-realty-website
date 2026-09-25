/**
 * Dev-only: builds the demo seed's coordinate pools in `scripts/seed-sites.json`
 * for the statewide areas, and checks every row in the file against public
 * sources. It needs the network and is never run in CI; the seed itself only
 * reads the committed JSON.
 *
 *   npx tsx scripts/dev/gen-seed-sites.ts             # add pools for areas missing from the file
 *   npx tsx scripts/dev/gen-seed-sites.ts --only rome # regenerate one statewide area
 *   npx tsx scripts/dev/gen-seed-sites.ts --check     # verify every row (all areas)
 *
 * Sources (ArcGIS REST, JSON). Responses are cached under the OS temp folder,
 * so a re-run is fast; delete `adams-gen-seed-sites` there to refetch.
 * - Census TIGERweb (current vintage): incorporated places, counties, 2020
 *   ZCTAs (the ZIP of each point), local/secondary/primary roads, and the
 *   military, correctional, college and National Park Service land-use areas.
 * - USGS National Hydrography Dataset (large scale): waterbodies (lakes,
 *   ponds, swamp and marsh) and areas (rivers, estuary, sea).
 * - USGS GNIS (National Map geonames): populated-place points, the `center`
 *   of each town area in seed-data.ts.
 * - City of Atlanta neighborhood boundaries (as published by Atlanta BeltLine
 *   GIS) for Virginia-Highland.
 * - Zippopotam.us: the USPS place name of each ZIP, so a listing's city is the
 *   ZIP's mailing city.
 *
 * Pools (see SiteKind in scripts/seed.ts):
 * - core: inside the place, within 1.2 km of the center (downtown).
 * - town: inside the place (or neighborhood), within 8 km of the center, so a
 *   sprawling or consolidated city (Athens-Clarke, Augusta-Richmond, Columbus,
 *   Macon-Bibb) never contributes its rural fringe.
 * - rural (non-urban areas only): inside the area's county, outside every
 *   incorporated place, 1–7 km from the city limits and within 15 km of the
 *   center. A consolidated city has no "outside", so its rural pool is its own
 *   fringe instead: inside the place, 8–14.5 km from the center.
 * Every point is on land (outside NHD water, 30 m clear of it), outside the
 * land-use areas above, 12–90 m from a street (rural: up to 200 m) and at
 * least 60 m from an interstate or freeway, at least 150 m from every other
 * point, and its ZIP's mailing city is the area's city (never a military
 * post's ZIP). Rows are `[lat, lng, county, city, zip]`.
 *
 * `--check` re-derives every row's facts (county, ZCTA and mailing city, city
 * limits, water, land use, lake shore distance, and each center against GNIS)
 * and fails on any error in the statewide areas or in an area's settings. The
 * 19 Northeast Georgia areas' rows predate this script and are frozen, because
 * the 180 listings built on them must not move; findings about those rows
 * (mostly ZIPs: a row without its own ZIP takes the area's) are listed as
 * warnings instead.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS, STATEWIDE_AREAS, type SeedArea } from "../seed-data";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITES_FILE = join(HERE, "..", "seed-sites.json");
const CACHE = join(tmpdir(), "adams-gen-seed-sites");

const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
const LAYERS = {
  places: `${TIGER}/tigerWMS_Current/MapServer/28`,
  counties: `${TIGER}/tigerWMS_Current/MapServer/82`,
  zctas: `${TIGER}/tigerWMS_Current/MapServer/2`,
  primaryRoads: `${TIGER}/Transportation/MapServer/2`,
  secondaryRoads: `${TIGER}/Transportation/MapServer/6`,
  localRoads: `${TIGER}/Transportation/MapServer/8`,
  landUse: [0, 1, 2, 3].map((id) => `${TIGER}/Special_Land_Use_Areas/MapServer/${id}`),
  nhdWaterbody: "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12",
  nhdArea: "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/9",
  gnis: "https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/3",
  atlantaNeighborhoods:
    "https://gis.beltline.org/server/rest/services/COA_Neighborhoods_public/FeatureServer/0",
};

/**
 * How each statewide area's "place" is found. GEOIDs are the Census place
 * codes; the four consolidated governments use their balance or combined
 * place, which covers (nearly) the whole county.
 */
const STATEWIDE_SOURCES: Record<
  string,
  { county: string; place: string; consolidated?: boolean; neighborhood?: string }
> = {
  atlanta: { county: "Fulton", place: "1304000" },
  "virginia-highland": { county: "Fulton", place: "1304000", neighborhood: "Virginia Highland" },
  decatur: { county: "DeKalb", place: "1322052" },
  marietta: { county: "Cobb", place: "1349756" },
  alpharetta: { county: "Fulton", place: "1301696" },
  athens: { county: "Clarke", place: "1303440", consolidated: true },
  augusta: { county: "Richmond", place: "1304204", consolidated: true },
  savannah: { county: "Chatham", place: "1369000" },
  macon: { county: "Bibb", place: "1349008", consolidated: true },
  columbus: { county: "Muscogee", place: "1319000", consolidated: true },
  rome: { county: "Floyd", place: "1366668" },
  dalton: { county: "Whitfield", place: "1321380" },
  "blue-ridge": { county: "Fannin", place: "1308928" },
  "warner-robins": { county: "Houston", place: "1380508" },
  milledgeville: { county: "Baldwin", place: "1351492" },
  statesboro: { county: "Bulloch", place: "1373256" },
  brunswick: { county: "Glynn", place: "1311560" },
  albany: { county: "Dougherty", place: "1301052" },
  valdosta: { county: "Lowndes", place: "1378800" },
  thomasville: { county: "Thomas", place: "1376224" },
};

/** NHD names of the lakes behind the lake areas. */
const LAKE_NAMES: Record<string, string> = {
  "lake-hartwell": "Hartwell Lake",
  "lake-lanier": "Lake Sidney Lanier",
};

export const RADIUS_M = { core: 1150, town: 7800, ruralMax: 14500 };
const MIN_SPACING_M = 150;
/**
 * ZIPs that belong to military posts (their ZCTAs spill past the gates onto a
 * few civilian streets, whose mail still uses the city ZIPs around them).
 */
const MILITARY_ZIPS: Record<string, string> = {
  "31098": "Robins Air Force Base",
  "31409": "Hunter Army Airfield",
  "31905": "Fort Moore",
  "30905": "Fort Eisenhower",
};
const WATER_CLEARANCE_M = 30;
const CHECK_CLEARANCE_M = 20;

// --- Fetching ---------------------------------------------------------------

type Ring = [number, number][];
type Feature = { attributes: Record<string, unknown>; rings?: Ring[]; paths?: Ring[] };

function cacheFile(key: string) {
  return join(CACHE, `${createHash("sha1").update(key).digest("hex")}.json`);
}

async function getJson(url: string): Promise<unknown> {
  const file = cacheFile(url);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "adams-realty-seed-dev (gen-seed-sites.ts)" },
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "ArcGIS error");
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, JSON.stringify(json));
      return json;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error(`${url.slice(0, 160)}…: ${String(lastError)}`);
}

type Envelope = { west: number; south: number; east: number; north: number };

/** Every feature of a layer matching `where` and intersecting `env`, paged. */
async function query(
  layer: string,
  opts: { where?: string; env?: Envelope; fields?: string; offset?: number },
): Promise<Feature[]> {
  const out: Feature[] = [];
  const pageSize = 2000;
  for (let page = 0; ; page++) {
    const params = new URLSearchParams({
      where: opts.where ?? "1=1",
      outFields: opts.fields ?? "*",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
      resultOffset: String(page * pageSize),
      resultRecordCount: String(pageSize),
    });
    if (opts.offset) params.set("maxAllowableOffset", String(opts.offset));
    if (opts.env) {
      const e = opts.env;
      params.set("geometry", `${e.west},${e.south},${e.east},${e.north}`);
      params.set("geometryType", "esriGeometryEnvelope");
      params.set("inSR", "4326");
      params.set("spatialRel", "esriSpatialRelIntersects");
    }
    const json = (await getJson(`${layer}/query?${params}`)) as {
      features: Array<{
        attributes: Record<string, unknown>;
        geometry?: { rings?: Ring[]; paths?: Ring[] };
      }>;
      exceededTransferLimit?: boolean;
    };
    for (const f of json.features) {
      out.push({ attributes: f.attributes, rings: f.geometry?.rings, paths: f.geometry?.paths });
    }
    if (!json.exceededTransferLimit && json.features.length < pageSize) return out;
  }
}

const zipCities = new Map<string, string[]>();
/** USPS place names for a ZIP (Zippopotam.us). */
async function citiesForZip(zip: string): Promise<string[]> {
  if (!zipCities.has(zip)) {
    const url = `https://api.zippopotam.us/us/${zip}`;
    const file = cacheFile(url);
    let json: { places?: Array<{ "place name": string; "state abbreviation": string }> };
    if (existsSync(file)) json = JSON.parse(readFileSync(file, "utf8"));
    else {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      json = res.ok ? await res.json() : {};
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, JSON.stringify(json));
    }
    zipCities.set(
      zip,
      (json.places ?? [])
        .filter((p) => p["state abbreviation"] === "GA")
        .map((p) => p["place name"]),
    );
  }
  return zipCities.get(zip)!;
}

// --- Geometry (local equirectangular metres around an origin) -------------------

type Pt = [number, number]; // [x, y] metres
type Shape = {
  rings: Pt[][];
  box: [number, number, number, number];
  attrs: Record<string, unknown>;
};

class Frame {
  private kx: number;
  private ky = 110_574;
  constructor(
    private lat0: number,
    private lng0: number,
  ) {
    this.kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  }
  toXY(lat: number, lng: number): Pt {
    return [(lng - this.lng0) * this.kx, (lat - this.lat0) * this.ky];
  }
  toLatLng([x, y]: Pt): [number, number] {
    return [this.lat0 + y / this.ky, this.lng0 + x / this.kx];
  }
  shape(f: Feature): Shape {
    const rings = (f.rings ?? f.paths ?? []).map((r) => r.map(([lng, lat]) => this.toXY(lat, lng)));
    const pts = rings.flat();
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return {
      rings,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      attrs: f.attributes,
    };
  }
}

function inBox(s: Shape, [x, y]: Pt, pad = 0) {
  return x >= s.box[0] - pad && x <= s.box[2] + pad && y >= s.box[1] - pad && y <= s.box[3] + pad;
}

/** Even-odd rule across all rings, so holes (enclaves) count as outside. */
function contains(s: Shape, p: Pt): boolean {
  if (!inBox(s, p)) return false;
  let inside = false;
  for (const ring of s.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Distance from `p` to the nearest edge (or polyline segment), capped at `max`. */
function edgeDistance(s: Shape, p: Pt, max: number): number {
  if (!inBox(s, p, max)) return max;
  let best = max;
  for (const ring of s.rings) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len)) : 0;
      const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

const nearest = (shapes: Shape[], p: Pt, max: number) =>
  shapes.reduce((d, s) => Math.min(d, edgeDistance(s, p, d)), max);

// --- Per-area context ---------------------------------------------------------

type Context = {
  frame: Frame;
  counties: Shape[];
  places: Shape[];
  zctas: Shape[];
  water: Shape[];
  landUse: Shape[];
  streets: Shape[];
  freeways: Shape[];
};

async function loadContext(
  center: [number, number],
  radiusM: number,
  { roads = true } = {},
): Promise<Context> {
  const [lat, lng] = center;
  const dLat = radiusM / 110_574;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const env = { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat };
  const frame = new Frame(lat, lng);
  const shapes = (fs: Feature[]) => fs.map((f) => frame.shape(f));
  const [counties, places, zctas, waterbodies, areas, landUse, primary, secondary, local] =
    await Promise.all([
      query(LAYERS.counties, { env, where: "STATE='13'", fields: "BASENAME" }),
      query(LAYERS.places, { env, where: "STATE='13'", fields: "GEOID,BASENAME,NAME" }),
      query(LAYERS.zctas, { env, fields: "ZCTA5" }),
      query(LAYERS.nhdWaterbody, { env, fields: "GNIS_NAME,FTYPE", offset: 0.00001 }),
      query(LAYERS.nhdArea, { env, fields: "GNIS_NAME,FTYPE", offset: 0.00001 }),
      Promise.all(LAYERS.landUse.map((l) => query(l, { env, fields: "NAME" }))).then((x) =>
        x.flat(),
      ),
      roads ? query(LAYERS.primaryRoads, { env, fields: "MTFCC,NAME" }) : [],
      roads ? query(LAYERS.secondaryRoads, { env, fields: "MTFCC,NAME" }) : [],
      roads ? query(LAYERS.localRoads, { env, where: "MTFCC='S1400'", fields: "MTFCC" }) : [],
    ]);
  return {
    frame,
    counties: shapes(counties),
    places: shapes(places),
    zctas: shapes(zctas),
    water: shapes([...waterbodies, ...areas]),
    landUse: shapes(landUse),
    streets: shapes([...secondary, ...local]),
    freeways: shapes(primary),
  };
}

const countyAt = (c: Context, p: Pt) =>
  c.counties.find((s) => contains(s, p))?.attrs.BASENAME as string | undefined;
const zipAt = (c: Context, p: Pt) =>
  c.zctas.find((s) => contains(s, p))?.attrs.ZCTA5 as string | undefined;
const placeAt = (c: Context, p: Pt) => c.places.find((s) => contains(s, p));
const onLand = (c: Context, p: Pt, clearance = WATER_CLEARANCE_M) =>
  !c.water.some((s) => contains(s, p)) && nearest(c.water, p, clearance) >= clearance;
const clearOfLandUse = (c: Context, p: Pt) => !c.landUse.some((s) => contains(s, p));

// --- Generation ---------------------------------------------------------------

type Row = [number, number, string, string, string];
type Pools = Partial<Record<"core" | "town" | "rural", Row[]>>;

function prng(seed: string) {
  let s = createHash("sha1").update(seed).digest().readInt32LE(0);
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export function poolSizes(area: Pick<SeedArea, "weight" | "urban">) {
  const quota = area.weight;
  return {
    core: Math.ceil(quota / 2) + 2,
    town: quota + 6,
    rural: area.urban ? 0 : quota + 4,
  };
}

async function generateArea(area: SeedArea): Promise<Pools> {
  const src = STATEWIDE_SOURCES[area.slug];
  if (!src) throw new Error(`No STATEWIDE_SOURCES entry for ${area.slug}`);
  const c = await loadContext(area.center, 16_000);
  const home = c.places.find((s) => s.attrs.GEOID === src.place);
  if (!home) throw new Error(`${area.slug}: place ${src.place} not found`);
  let within = home;
  if (src.neighborhood) {
    const [nb] = await query(LAYERS.atlantaNeighborhoods, {
      where: `name='${src.neighborhood}'`,
      fields: "name",
    });
    if (!nb) throw new Error(`${area.slug}: neighborhood ${src.neighborhood} not found`);
    within = c.frame.shape(nb);
  }
  const sizes = poolSizes(area);
  const rand = prng(area.slug);
  const taken: Pt[] = [];
  const pools: Pools = {};

  const accept = async (p: Pt, kind: "core" | "town" | "rural"): Promise<Row | null> => {
    const d = Math.hypot(p[0], p[1]);
    const inHome = contains(home, p) && contains(within, p);
    if (kind === "core" && !(inHome && d <= RADIUS_M.core)) return null;
    if (kind === "town" && !(inHome && d <= RADIUS_M.town)) return null;
    if (kind === "rural") {
      if (d > RADIUS_M.ruralMax) return null;
      if (src.consolidated) {
        if (!(inHome && d >= 8200)) return null;
        const other = placeAt(c, p);
        if (other && other !== home) return null;
      } else {
        if (placeAt(c, p)) return null;
        const fromLimits = edgeDistance(home, p, 7000);
        if (fromLimits < 1000 || fromLimits >= 7000) return null;
      }
    }
    if (taken.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < MIN_SPACING_M)) return null;
    const county = countyAt(c, p);
    if (!county || (kind === "rural" && county !== src.county)) return null;
    if (!onLand(c, p) || !clearOfLandUse(c, p)) return null;
    const street = nearest(c.streets, p, 250);
    if (street < 12 || street > (kind === "rural" ? 200 : 90)) return null;
    if (nearest(c.freeways, p, 60) < 60) return null;
    const zip = zipAt(c, p);
    if (!zip || MILITARY_ZIPS[zip] || !(await citiesForZip(zip)).includes(area.city)) return null;
    const [lat, lng] = c.frame.toLatLng(p);
    return [round5(lat), round5(lng), county, area.city, zip];
  };

  const fill = async (kind: "core" | "town" | "rural", want: number, sample: () => Pt) => {
    const rows: Row[] = [];
    for (let tries = 0; rows.length < want && tries < 60_000; tries++) {
      const p = sample();
      const row = await accept(p, kind);
      if (row) {
        rows.push(row);
        taken.push(p);
      }
    }
    if (rows.length < want) {
      throw new Error(`${area.slug}: only ${rows.length}/${want} ${kind} sites; loosen or check`);
    }
    return rows;
  };
  const disk = (r0: number, r1: number) => (): Pt => {
    const r = Math.sqrt(r0 * r0 + rand() * (r1 * r1 - r0 * r0));
    const a = rand() * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  // Town candidates are drawn over the place's own extent, so small towns fill quickly.
  const [bx0, by0, bx1, by1] = within.box;
  const inExtent = (): Pt => [bx0 + rand() * (bx1 - bx0), by0 + rand() * (by1 - by0)];

  pools.core = await fill("core", sizes.core, disk(0, RADIUS_M.core));
  pools.town = await fill("town", sizes.town, inExtent);
  if (sizes.rural) {
    pools.rural = await fill(
      "rural",
      sizes.rural,
      src.consolidated ? disk(8200, RADIUS_M.ruralMax) : disk(1000, RADIUS_M.ruralMax),
    );
  }
  return pools;
}

// --- Checking -----------------------------------------------------------------

async function gnisCenter(area: SeedArea): Promise<[number, number] | null> {
  const name = area.kind === "neighborhood" ? "Virginia Highlands" : area.city;
  const json = (await getJson(
    `${LAYERS.gnis}/query?${new URLSearchParams({
      where: `state_alpha='GA' and gaz_name='${name.replace(/'/g, "''")}'`,
      outFields: "gaz_id,county_name",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
    })}`,
  )) as { features: Array<{ attributes: { county_name: string }; geometry: { points: Pt[] } }> };
  // A name can repeat across the state (Jefferson, Dalton, Thomasville): take the
  // feature whose first point is nearest the area's center.
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const f of json.features) {
    const [lng, lat] = f.geometry.points[0];
    const d = Math.hypot(lat - area.center[0], lng - area.center[1]);
    if (d < bestD) [best, bestD] = [[lat, lng], d];
  }
  return best;
}

async function checkArea(
  area: SeedArea,
  pools: Record<string, (string | number)[][]>,
): Promise<string[]> {
  const problems: string[] = [];
  const isLake = area.kind === "lake";
  const c = await loadContext(area.center, isLake ? 45_000 : 17_000, { roads: false });
  const fail = (kind: string, row: (string | number)[], why: string) =>
    problems.push(`${area.slug}.${kind} [${row.join(", ")}]: ${why}`);

  if (!isLake) {
    const g = await gnisCenter(area);
    const d = g ? Math.hypot(...c.frame.toXY(g[0], g[1])) : Infinity;
    if (d > 60) problems.push(`${area.slug}: center is ${Math.round(d)} m from the GNIS point`);
  }
  if (!(await citiesForZip(area.zip)).includes(area.city)) {
    problems.push(`${area.slug}: default ZIP ${area.zip} is not a ${area.city} ZIP`);
  }

  const src = STATEWIDE_SOURCES[area.slug];
  const home = isLake
    ? undefined
    : src
      ? c.places.find((s) => s.attrs.GEOID === src.place)
      : c.places.find((s) => s.attrs.BASENAME === area.city);
  if (!isLake && !home) problems.push(`${area.slug}: no place named ${area.city}`);

  let lake: Shape[] = [];
  if (isLake) {
    lake = c.water.filter((s) => s.attrs.GNIS_NAME === LAKE_NAMES[area.slug]);
    if (!lake.length) problems.push(`${area.slug}: NHD has no ${LAKE_NAMES[area.slug]}`);
    const [south, west] = c.frame.toLatLng([
      Math.min(...lake.map((s) => s.box[0])),
      Math.min(...lake.map((s) => s.box[1])),
    ]);
    const [north, east] = c.frame.toLatLng([
      Math.max(...lake.map((s) => s.box[2])),
      Math.max(...lake.map((s) => s.box[3])),
    ]);
    const nhd = { west, south, east, north };
    const drift = (Object.keys(nhd) as (keyof Envelope)[]).filter(
      (k) => Math.abs(nhd[k] - (area.lakeBounds?.[k] ?? Infinity)) > 0.001,
    );
    if (drift.length) {
      problems.push(`${area.slug}: lakeBounds differ from NHD ${JSON.stringify(nhd)}`);
    }
  }

  for (const [kind, rows] of Object.entries(pools)) {
    for (const row of rows) {
      const [lat, lng, county, city, zip] = row as [number, number, string, string?, string?];
      const p = c.frame.toXY(lat, lng);
      const actualCounty = countyAt(c, p);
      if (actualCounty !== county) fail(kind, row, `county is ${actualCounty}`);
      // Rows without a city and ZIP get the area's (see takeSite in scripts/seed.ts).
      const listedZip = zip ?? area.zip;
      const listedCity = city ?? area.city;
      const actualZip = zipAt(c, p);
      if (actualZip !== listedZip) {
        const names = actualZip ? (await citiesForZip(actualZip)).join("/") : "none";
        fail(
          kind,
          row,
          `listed as ${listedCity} ${listedZip}, but the ZCTA is ${actualZip} (${names})`,
        );
      }
      if (MILITARY_ZIPS[listedZip])
        fail(kind, row, `${listedZip} is ${MILITARY_ZIPS[listedZip]}'s ZIP`);
      if (!(await citiesForZip(listedZip)).includes(listedCity)) {
        fail(kind, row, `${listedZip} is not a ${listedCity} ZIP`);
      }
      // New rows keep 30 m from water; older waterfront rows sit 25 m from the shore.
      if (!onLand(c, p, CHECK_CLEARANCE_M)) {
        const inWater = c.water.some((w) => contains(w, p));
        const d = Math.round(nearest(c.water, p, CHECK_CLEARANCE_M));
        fail(kind, row, inWater ? "in NHD water" : `${d} m from NHD water`);
      }
      if (!clearOfLandUse(c, p)) fail(kind, row, "inside a military/prison/college/park area");
      if (kind === "core" || kind === "town") {
        if (home && !contains(home, p)) {
          const d = Math.round(edgeDistance(home, p, 20_000));
          fail(kind, row, `${d} m outside ${area.city}'s limits`);
        }
      }
      if (kind === "rural" && !src?.consolidated) {
        const other = placeAt(c, p);
        if (other) fail(kind, row, `inside ${String(other.attrs.NAME)}`);
      }
      if (isLake && lake.length) {
        const d = nearest(lake, p, 5000);
        if (kind === "waterfront" && d > 150) fail(kind, row, `${Math.round(d)} m from the lake`);
        if (kind === "near" && (d < 200 || d > 3000)) {
          fail(kind, row, `${Math.round(d)} m from the lake`);
        }
      }
    }
  }
  return problems;
}

// --- File I/O -----------------------------------------------------------------

type SitesFile = { about: string; areas: Record<string, Record<string, (string | number)[][]>> };

const ABOUT = [
  "Demo seed coordinates, one list per seed area (scripts/seed-data.ts).",
  "Northeast Georgia areas: every point was checked to be on land against USGS National Hydrography Dataset waterbodies and to fall inside the listed Georgia county (USGS National Map boundaries). core: near downtown; town: inside city limits; rural: 1-7 km outside town; waterfront: 25-100 m from the lake shore (mainland); near: 250 m-2.5 km from the lake. Row format: [lat, lng, county] or, for lakes, [lat, lng, county, city, zip].",
  "Statewide areas: generated by scripts/dev/gen-seed-sites.ts from Census TIGERweb (places, counties, 2020 ZCTAs, roads, military, prison, college and park land), USGS NHD water and marsh, and USGS GNIS centers. core: inside city limits within 1.2 km of the center; town: inside city limits (Virginia-Highland: the City of Atlanta neighborhood) within 8 km; rural: outside every incorporated place, 1-7 km from the city limits (consolidated city-counties: their own fringe, 8-14.5 km out). Every point is on land, near a street, 150 m from any other, and its ZIP (the ZCTA at the point) has the row's city as its mailing city. Row format: [lat, lng, county, city, zip].",
  "Run `npx tsx scripts/dev/gen-seed-sites.ts --check` to re-verify every row.",
].join(" ");

/** Serializes like Prettier formats this file, so untouched areas stay byte-identical. */
function serialize(file: SitesFile): string {
  const row = (r: (string | number)[]) => `[${r.map((v) => JSON.stringify(v)).join(", ")}]`;
  const areas = Object.entries(file.areas).map(([slug, pools]) => {
    const kinds = Object.entries(pools).map(
      ([kind, rows]) =>
        `      ${JSON.stringify(kind)}: [\n${rows.map((r) => `        ${row(r)}`).join(",\n")}\n      ]`,
    );
    return `    ${JSON.stringify(slug)}: {\n${kinds.join(",\n")}\n    }`;
  });
  return `{\n  "about": ${JSON.stringify(file.about)},\n  "areas": {\n${areas.join(",\n")}\n  }\n}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const file = JSON.parse(readFileSync(SITES_FILE, "utf8")) as SitesFile;

  if (args.includes("--check")) {
    const errors: string[] = [];
    // The Northeast Georgia rows are frozen (the 180 listings built on them must
    // not move), so findings about individual rows there are reported, not fatal.
    const legacy: string[] = [];
    for (const area of [...AREAS, ...STATEWIDE_AREAS]) {
      const pools = file.areas[area.slug];
      if (!pools) {
        errors.push(`${area.slug}: no rows`);
        continue;
      }
      const found = await checkArea(area, pools);
      const frozen = AREAS.includes(area);
      const rowFindings = found.filter((p) => frozen && p.startsWith(`${area.slug}.`));
      legacy.push(...rowFindings);
      errors.push(...found.filter((p) => !rowFindings.includes(p)));
      console.info(`${area.slug}: ${found.length ? `${found.length} finding(s)` : "ok"}`);
    }
    if (legacy.length) {
      console.warn(`\n${legacy.length} finding(s) in the frozen Northeast Georgia rows:`);
      for (const p of legacy) console.warn(`  ${p}`);
    }
    if (errors.length) console.error(`\n${errors.length} error(s):`);
    for (const p of errors) console.error(`  ${p}`);
    process.exit(errors.length ? 1 : 0);
  }

  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  if (only && AREAS.some((a) => a.slug === only)) {
    throw new Error(`${only} is a Northeast Georgia area; its rows are never regenerated.`);
  }
  for (const area of STATEWIDE_AREAS) {
    if (only ? area.slug !== only : file.areas[area.slug]) continue;
    console.info(`Generating ${area.slug}…`);
    file.areas[area.slug] = (await generateArea(area)) as Record<string, (string | number)[][]>;
    // Write after every area, so a network failure doesn't lose finished work.
    writeFileSync(SITES_FILE, serialize({ ...file, about: ABOUT }));
  }
  writeFileSync(SITES_FILE, serialize({ ...file, about: ABOUT }));
  console.info("Done. Run with --check to verify every row.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
