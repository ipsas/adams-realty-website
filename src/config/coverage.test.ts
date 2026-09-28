import { describe, expect, it } from "vitest";
import {
  AREAS,
  LAKE_FIXTURES,
  STATEWIDE_AREAS,
  STATEWIDE_LAKES,
  type SeedArea,
} from "../../scripts/seed-data";
import SITES from "../../scripts/seed-sites.json";
import { areas as guides } from "./areas";
import { site } from "./site";

/**
 * The demo seed's coordinate pools (scripts/seed-sites.json) against the
 * areas they belong to. The pools themselves are built and checked against
 * Census and USGS data by scripts/dev/gen-seed-sites.ts (network, dev-only);
 * this test keeps them in shape offline.
 */

type Row = [number, number, string, string?, string?];
const sites = SITES.areas as unknown as Record<string, Record<string, Row[]>>;
const ALL = [...AREAS, ...STATEWIDE_AREAS, ...STATEWIDE_LAKES];

/** Georgia, the statewide listing coverage. */
const GEORGIA = site.coverage.bounds;

/** Maximum distance of each pool from its area's center, km. Lakes use their bounds instead. */
const RADIUS_KM = { core: 1.2, town: 8, rural: 15 } as const;
const LAKE_MARGIN_KM = 3;

function km([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** A lake's bounds grown by `marginKm` on every side. */
function grow(b: NonNullable<SeedArea["lakeBounds"]>, marginKm: number) {
  const dLat = marginKm / 110.574;
  const dLng = marginKm / (111.32 * Math.cos((((b.south + b.north) / 2) * Math.PI) / 180));
  return { west: b.west - dLng, south: b.south - dLat, east: b.east + dLng, north: b.north + dLat };
}

const inside = (
  b: { west: number; south: number; east: number; north: number },
  [lat, lng]: [number, number],
) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;

/** Farthest distance (km) of any row in `kind` from the area's center. */
const farthest = (a: SeedArea, kind: string) =>
  Math.max(0, ...(sites[a.slug]?.[kind] ?? []).map(([lat, lng]) => km(a.center, [lat, lng])));

describe("seed-sites.json", () => {
  it("has pools for exactly the seed's areas", () => {
    expect(new Set(ALL.map((a) => a.slug)).size).toBe(ALL.length);
    expect(Object.keys(sites).sort()).toEqual(ALL.map((a) => a.slug).sort());
    for (const a of ALL) {
      const kinds = Object.keys(sites[a.slug]).sort();
      expect(kinds, a.slug).toEqual(
        a.kind === "lake"
          ? ["near", "waterfront"]
          : a.urban
            ? ["core", "town"]
            : ["core", "rural", "town"],
      );
    }
  });

  it("keeps every point in Georgia", () => {
    for (const a of ALL) {
      expect(inside(GEORGIA, a.center), a.slug).toBe(true);
      for (const [kind, rows] of Object.entries(sites[a.slug])) {
        for (const [lat, lng] of rows) {
          expect(inside(GEORGIA, [lat, lng]), `${a.slug}.${kind} ${lat},${lng}`).toBe(true);
        }
      }
    }
  });

  describe.each(ALL.filter((a) => a.kind !== "lake").map((a) => [a.slug, a] as const))(
    "%s",
    (_, a) => {
      it(`keeps core within ${RADIUS_KM.core} km of the center`, () => {
        expect(farthest(a, "core")).toBeLessThanOrEqual(RADIUS_KM.core);
      });
      it("keeps town within the town radius", () => {
        expect(farthest(a, "town")).toBeLessThanOrEqual(a.townReachKm ?? RADIUS_KM.town);
      });
      it(`keeps rural within ${RADIUS_KM.rural} km`, () => {
        expect(farthest(a, "rural")).toBeLessThanOrEqual(RADIUS_KM.rural);
      });
    },
  );

  describe.each(ALL.filter((a) => a.kind === "lake").map((a) => [a.slug, a] as const))(
    "%s",
    (_, a) => {
      it(`keeps every site within ${LAKE_MARGIN_KM} km of the lake`, () => {
        expect(a.lakeBounds).toBeDefined();
        const box = grow(a.lakeBounds!, LAKE_MARGIN_KM);
        expect(inside(a.lakeBounds!, a.center)).toBe(true);
        for (const kind of ["waterfront", "near"]) {
          for (const [lat, lng] of sites[a.slug][kind]) {
            expect(inside(box, [lat, lng]), `${kind} ${lat},${lng}`).toBe(true);
          }
        }
      });
    },
  );

  it("widens the town radius only where existing city limits need it", () => {
    for (const a of ALL.filter((x) => x.townReachKm !== undefined)) {
      // Never for a statewide area, whose pools the generator stops at 8 km…
      expect(STATEWIDE_AREAS.includes(a), a.slug).toBe(false);
      // …and only as far as the farthest existing row needs.
      expect(farthest(a, "town"), a.slug).toBeGreaterThan(RADIUS_KM.town);
      expect(a.townReachKm! - farthest(a, "town"), a.slug).toBeLessThan(0.5);
    }
  });

  it("puts each town area's center on its area guide's center", () => {
    for (const a of AREAS.filter((x) => x.kind === "town")) {
      const guide = guides.find((g) => g.slug === a.slug);
      expect(guide, a.slug).toBeDefined();
      expect(km(a.center, [guide!.center.lat, guide!.center.lng]), a.slug).toBeLessThan(0.1);
    }
  });

  it("gives statewide rows a city and ZIP, and pools big enough for the quotas", () => {
    for (const a of STATEWIDE_AREAS) {
      const pools = sites[a.slug];
      for (const rows of Object.values(pools)) {
        for (const [, , county, city, zip] of rows) {
          expect(county, a.slug).toMatch(/^[A-Z][A-Za-z]+$/);
          expect(city, a.slug).toBe(a.city);
          expect(zip, a.slug).toMatch(/^3\d{4}$/);
        }
      }
      expect(pools.town.length, a.slug).toBeGreaterThanOrEqual(a.weight + 4);
      expect(pools.core.length, a.slug).toBeGreaterThanOrEqual(Math.ceil(a.weight / 2));
      if (!a.urban) expect(pools.rural.length, a.slug).toBeGreaterThanOrEqual(a.weight);
    }
  });

  it("gives statewide lake rows their own city and ZIP, and enough waterfront for every listing", () => {
    for (const a of STATEWIDE_LAKES) {
      const pools = sites[a.slug];
      for (const rows of Object.values(pools)) {
        for (const [, , county, city, zip] of rows) {
          expect(county, a.slug).toMatch(/^[A-Z][A-Za-z]+$/);
          expect(city, a.slug).toMatch(/^[A-Z][A-Za-z ]+$/);
          expect(zip, a.slug).toMatch(/^3\d{4}$/);
        }
      }
      // Every listing could be on the water, plus the lake's fixture home.
      const fixtures = LAKE_FIXTURES.filter((f) => f.area === a.slug).length;
      expect(pools.waterfront.length, a.slug).toBeGreaterThanOrEqual(a.weight + fixtures);
      expect(pools.near.length, a.slug).toBeGreaterThanOrEqual(a.weight);
    }
  });

  it("puts each lake fixture home on its own lake's area", () => {
    for (const f of LAKE_FIXTURES) {
      const area = ALL.find((a) => a.slug === f.area);
      expect(area?.kind, f.query).toBe("lake");
      expect(f.query, f.area).toBe(area!.name);
    }
  });

  it("never puts two statewide listings on the same spot", () => {
    const points = [...STATEWIDE_AREAS, ...STATEWIDE_LAKES].flatMap((a) =>
      Object.values(sites[a.slug]).flatMap((rows) => rows.map(([lat, lng]) => [lat, lng] as const)),
    );
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = km([points[i][0], points[i][1]], [points[j][0], points[j][1]]);
        if (d < 0.14)
          expect.fail(`${points[i]} and ${points[j]} are ${Math.round(d * 1000)} m apart`);
      }
    }
  });
});

describe("statewide seed areas", () => {
  it("are other brokerages' listings only: 226, plus 12 on the statewide lakes", () => {
    for (const a of [...STATEWIDE_AREAS, ...STATEWIDE_LAKES]) expect(a.ourWeight, a.slug).toBe(0);
    expect(STATEWIDE_AREAS.reduce((s, a) => s + a.weight, 0)).toBe(226);
    expect(STATEWIDE_LAKES.reduce((s, a) => s + a.weight, 0)).toBe(12);
  });

  it("keep farms and manufactured homes out of urban areas", () => {
    for (const a of ALL.filter((x) => x.urban)) {
      expect(a.mix.farm_ranch, a.slug).toBeUndefined();
      expect(a.mix.manufactured, a.slug).toBeUndefined();
    }
  });

  it("never name another town in a vibe (descriptions are full-text indexed)", () => {
    for (const a of ALL) {
      for (const other of ALL) {
        const name = other.kind === "town" ? other.city : other.name;
        if (name === a.city || name === a.name) continue;
        expect(a.vibe, `${a.slug} mentions ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
      }
    }
  });
});
