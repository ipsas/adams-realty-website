import type { Area } from "@/config/areas";

/**
 * Heading of the "nearby" guide links on /areas/[slug]. Wording approved in
 * copy approvals section 22 (C3-A4). Lives here, not in the page file, because
 * a Next.js page may only export its route fields.
 */
export const NEARBY_GUIDES_HEADING = "Nearby town guides";

/** Great-circle (haversine) distance between two points, in km. */
function distanceKm(a: Area["center"], b: Area["center"]): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The `limit` guides whose `center` is nearest `area`'s, in any region or county,
 * leaving out `area` itself and the `exclude` slugs (guides already linked).
 * Nearest first; equal distances fall back to slug order.
 */
export function nearbyAreas(
  area: Pick<Area, "slug" | "center">,
  allAreas: readonly Area[],
  exclude: Iterable<string> = [],
  limit = 5,
): Area[] {
  const skip = new Set(exclude);
  skip.add(area.slug);
  return allAreas
    .filter((a) => !skip.has(a.slug))
    .map((a) => ({ a, d: distanceKm(area.center, a.center) }))
    .sort((x, y) => x.d - y.d || (x.a.slug < y.a.slug ? -1 : x.a.slug > y.a.slug ? 1 : 0))
    .slice(0, limit)
    .map((x) => x.a);
}
