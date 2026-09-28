import type { Page } from "@playwright/test";
import { site } from "../../src/config/site";
import { expect, gotoHydrated, test, touchTap, withDb } from "./helpers";

/*
 * GA-A's statewide map default view on phones. The search map starts hidden behind the list
 * (0×0; MapLibre then sizes itself as 400×300), so a fit made at creation suits a box the
 * phone never shows. The first time the map is shown it must open framed for its real size:
 * on the search's homes, or on all of Georgia when there are none.
 */

type Box = { west: number; south: number; east: number; north: number };
type View = Box & { zoom: number };

async function openMap(page: Page, url: string): Promise<View> {
  await gotoHydrated(page, url, "[aria-live=polite]");
  await expect(page.locator(".maplibregl-map")).toBeHidden();
  await touchTap(page, page.getByRole("button", { name: "Map", exact: true }));
  await expect(page.locator(".maplibregl-map")).toBeVisible();
  return page
    .waitForFunction(() => {
      const map = (window as unknown as { __searchMap?: import("maplibre-gl").Map }).__searchMap;
      const el = document.querySelector<HTMLElement>(".maplibregl-map");
      if (!map || !el || el.clientWidth === 0 || map.isMoving()) return null;
      // MapLibre has resized to the shown container.
      if (Math.abs(map.getCanvas().clientHeight - el.clientHeight) > 1) return null;
      const b = map.getBounds();
      return {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
        zoom: map.getZoom(),
      };
    })
    .then((h) => h.jsonValue() as Promise<View>);
}

const contains = (v: Box, b: Box) =>
  v.west <= b.west && v.east >= b.east && v.south <= b.south && v.north >= b.north;

/**
 * How snugly the view frames `box`: the smaller of its two axes' view/box span ratios. A fit
 * fills one axis less its padding, so this stays near 1; a fit made for another size doesn't.
 */
const snugness = (v: Box, b: Box) =>
  Math.min((v.east - v.west) / (b.east - b.west), (v.north - v.south) / (b.north - b.south));

test("with no homes to show, the phone map opens on all of Georgia", async ({ page }) => {
  const v = await openMap(page, "/homes?q=Nowhereville");
  expect(contains(v, site.coverage.bounds)).toBe(true);
  expect(snugness(v, site.coverage.bounds)).toBeLessThan(1.3);
});

test("with results, the phone map opens fitted to them", async ({ page }) => {
  // The pins: every Savannah home for sale (well under the pin cap).
  const [pins] = await withDb((db) =>
    db
      .query<Box>(
        `select min(longitude) as west, min(latitude) as south, max(longitude) as east,
                max(latitude) as north
           from listings
          where city = 'Savannah' and removed_at is null and transaction_type = 'sale'
            and status in ('active', 'coming_soon')`,
      )
      .then((r) => r.rows),
  );
  const v = await openMap(page, "/homes?q=Savannah");
  expect(contains(v, pins)).toBe(true);
  // 56px padding each side on a ~375px-wide map: under 1.5× the pins' span.
  expect(snugness(v, pins)).toBeLessThan(1.5);
});
