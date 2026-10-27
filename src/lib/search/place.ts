import { and, isNotNull, sql } from "drizzle-orm";
import { normalizeAreaName } from "@/config/areas";
import type { Executor } from "@/db";
import { listings } from "@/db/schema";
import { countyDisplay, normalizedMatch } from "@/lib/areas/match";
import { publicListing } from "@/lib/listings/visibility";
import type { Bounds, SearchCriteria } from "./params";
import {
  buildWhere,
  countyCondition,
  countyKey,
  lakeGuide,
  locationWhere,
  normalizeLocationQuery,
  type LocationScope,
} from "./query";

/**
 * Where a search's place is, looked up in the listings (site review #5). Only
 * public listings count, of any status, so a town whose homes all sold is
 * still a town.
 */

/**
 * The town the location box names exactly, as the listings spell it
 * ("hartwell" → "Hartwell"), or undefined: a ZIP, a lake (which is searched as
 * a lake area), a neighborhood, an address or a place with no listings. A town
 * search then shows that town only (`LocationScope.town`).
 */
export async function resolveTown(
  ex: Executor,
  q: string | undefined,
): Promise<string | undefined> {
  if (!q) return undefined;
  const text = normalizeLocationQuery(q);
  if (!text || /^\d{5}$/.test(text) || lakeGuide(q)) return undefined;
  const key = normalizeAreaName(text);
  if (!key) return undefined;
  const [row] = await ex
    .select({ city: listings.city })
    .from(listings)
    .where(and(publicListing(), normalizedMatch(listings.city, [key])))
    .limit(1);
  return row?.city;
}

/**
 * The county the location box names, when it isn't a town: "Hall County",
 * "hall county, GA" or a bare "Hall" → "Hall County", if some public listing
 * is there. Undefined otherwise.
 */
export async function resolveCounty(
  ex: Executor,
  q: string | undefined,
): Promise<string | undefined> {
  const key = countyKey(q);
  if (!key) return undefined;
  // max() prefers a mixed-case spelling ("Hall") over a feed's capitals ("HALL").
  const [row] = await ex
    .select({ county: sql<string | null>`max(${listings.county})` })
    .from(listings)
    .where(and(publicListing(), countyCondition(key)));
  return row?.county ? countyDisplay(row.county) : undefined;
}

/**
 * The search's location scope: a town (`resolveTown`) first, so "Forsyth"
 * and "Gainesville" stay towns, else a county (`resolveCounty`).
 */
export async function resolveScope(
  ex: Executor,
  c: Pick<SearchCriteria, "q">,
): Promise<LocationScope> {
  const town = await resolveTown(ex, c.q);
  if (town) return { town };
  const county = await resolveCounty(ex, c.q);
  return county ? { county } : {};
}

type LatLng = { lat: number; lng: number };

/** A box around a point, `deg` degrees each way. */
export function boxAround(p: LatLng, deg: number): Bounds {
  return {
    west: p.lng - deg,
    east: p.lng + deg,
    south: p.lat - deg,
    north: p.lat + deg,
  };
}

/** The middle of a box. */
export function centerOf(b: Bounds): LatLng {
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/**
 * Where the searched place is: the box around its listings of any status, or
 * around a lake guide's center when none has coordinates. Null for a place
 * with no listings (the map then shows the state). A single home gets a small
 * box, not a point.
 */
export async function placeBounds(
  ex: Executor,
  q: string | undefined,
  scope: LocationScope = {},
): Promise<Bounds | null> {
  const where = q ? locationWhere(q, scope) : undefined;
  if (!where) return null;
  const [row] = await ex
    .select({
      south: sql<number | null>`min(${listings.latitude})`,
      north: sql<number | null>`max(${listings.latitude})`,
      west: sql<number | null>`min(${listings.longitude})`,
      east: sql<number | null>`max(${listings.longitude})`,
    })
    .from(listings)
    .where(
      and(publicListing(), where, isNotNull(listings.latitude), isNotNull(listings.longitude)),
    );
  if (row && row.south !== null && row.north !== null && row.west !== null && row.east !== null) {
    const pad = 0.01;
    return {
      south: Number(row.south) - pad,
      north: Number(row.north) + pad,
      west: Number(row.west) - pad,
      east: Number(row.east) + pad,
    };
  }
  const lake = lakeGuide(q);
  return lake ? boxAround(lake.center, 0.08) : null;
}

export type NearbyTown = {
  city: string;
  /** Homes there that match the search (or, when `filtered` is false, the mode alone). */
  count: number;
  /** Whether the count honors the search's filters; if not, the link drops them. */
  filtered: boolean;
};

/** How far to look for nearby towns: about 70 miles each way. */
const NEARBY_DEG = 1;

/**
 * Up to `limit` towns closest to `center` that have homes for the search
 * (its mode and filters, anywhere near), nearest first, leaving out the town
 * searched. When no town nearby has a match, the nearest towns with any homes
 * in the mode instead, marked `filtered: false`. For the no-results page.
 */
export async function nearbyTowns(
  ex: Executor,
  c: SearchCriteria,
  center: LatLng,
  exclude: string | undefined,
  limit = 3,
): Promise<NearbyTown[]> {
  const find = async (crit: SearchCriteria) => {
    const lat = sql<number>`avg(${listings.latitude})`;
    const lng = sql<number>`avg(${listings.longitude})`;
    // Longitude degrees shrink with latitude; close enough to rank towns.
    const k = Math.cos((center.lat * Math.PI) / 180);
    const rows = await ex
      .select({ city: listings.city, count: sql<number>`count(*)::int` })
      .from(listings)
      .where(
        buildWhere({
          ...crit,
          q: undefined,
          bounds: boxAround(center, NEARBY_DEG),
          page: 1,
        }),
      )
      .groupBy(listings.city)
      .orderBy(
        sql`power(${lat} - ${center.lat}, 2) + power((${lng} - ${center.lng}) * ${k}, 2)`,
        listings.city,
      )
      .limit(limit + 1);
    const skip = exclude ? normalizeAreaName(exclude) : null;
    return rows.filter((r) => normalizeAreaName(r.city) !== skip).slice(0, limit);
  };
  const matching = await find(c);
  if (matching.length) return matching.map((r) => ({ ...r, filtered: true }));
  const plain = await find({ mode: c.mode, sort: "recommended", page: 1 });
  return plain.map((r) => ({ ...r, filtered: false }));
}
