import { type Page, expect, type test as baseTest } from "@playwright/test";
import { signIn } from "./helpers";
import {
  expectNoHorizontalOverflow,
  expectTapTargets,
  gotoHydrated,
  touchDrag,
  withDb,
} from "./mobile/helpers";

/*
 * Searches that show the right homes, and land treated as land (site review #5 and #8,
 * docs/plans/site-review-2026-09-29.md): a town search is that town only, a lake is one
 * "lake area" suggestion, a moved map searches every home in view with a way back to the
 * town, no results is never a dead end, commercial stays out of the default search, the
 * heading follows the type filter, and land shows acres, price per acre, its own sorts,
 * its own page wording and a land-loan estimate. e2e/search-land.spec.ts runs it on
 * desktop and e2e/mobile/search-land.spec.ts on pixel7 and iphone13. Not a spec file.
 */

const READY = "[aria-live=polite]";
const ACRE = 43_560;
/** What /homes lists by default, straight from the database. */
const FOR_SALE = `removed_at is null and not idx_hidden and transaction_type = 'sale'
  and status in ('active', 'coming_soon')`;

async function resultCount(page: Page): Promise<number> {
  const live = page.locator(READY);
  await expect(live).toContainText(/\d+ results?/);
  const text = (await live.textContent()) ?? "";
  return Number(text.match(/([\d,]+) results?/)![1].replace(/,/g, ""));
}

const count = (where: string, params: unknown[] = []) =>
  withDb((db) =>
    db
      .query<{ n: number }>(`select count(*)::int as n from listings where ${where}`, params)
      .then((r) => r.rows[0].n),
  );

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const list = (page: Page) => page.locator("[data-results-list]");

/** The biggest bare tract for sale, for the land page and its preview. */
async function biggestTract() {
  return withDb((db) =>
    db
      .query<{ slug: string; mls: string; price: number; lot: number }>(
        `select slug, mls_number as mls, list_price as price, lot_size_sqft as lot from listings
          where ${FOR_SALE} and property_type = 'land' and lot_size_sqft > 0
            and coalesce(living_area_sqft, 0) = 0
          order by lot_size_sqft desc limit 1`,
      )
      .then((r) => r.rows[0]),
  );
}

const perAcre = (price: number, lot: number) =>
  `$${Math.round(price / (lot / ACRE)).toLocaleString("en-US")}/acre`;

/** "Land · 12.5 acres · $8,400/acre" → 12.5 */
const acresIn = (text: string) => Number(/· ([\d.,]+) acres?/.exec(text)![1].replace(/,/g, ""));
const perAcreIn = (text: string) => Number(/\$([\d,]+)\/acre/.exec(text)![1].replace(/,/g, ""));

export function searchLandSuite(test: typeof baseTest, { phone }: { phone: boolean }) {
  test.describe("a town search is that town only (site review #5)", () => {
    test("'Hartwell' lists Hartwell's homes, not the lake's homes in other towns", async ({
      page,
    }) => {
      // The seed has Lake Hartwell homes whose mail goes to Lavonia and Toccoa.
      expect(
        await count(
          `${FOR_SALE} and city <> 'Hartwell' and (neighborhood = 'Lake Hartwell' or water_body = 'Lake Hartwell')`,
        ),
      ).toBeGreaterThan(0);
      const town = await count(
        `${FOR_SALE} and city = 'Hartwell' and property_type <> 'commercial'`,
      );

      await gotoHydrated(page, "/homes?q=Hartwell", READY);
      await expect(heading(page)).toHaveText("Homes for sale in Hartwell");
      expect(await resultCount(page)).toBe(town);
      const addresses = await page.getByTestId("card-address").allTextContents();
      expect(addresses.length).toBe(Math.min(town, 24));
      for (const a of addresses) expect(a).toMatch(/, Hartwell, GA 3\d{4}$/);
    });

    test("the lake is one suggestion, and its search is the lake area", async ({ page }) => {
      await gotoHydrated(page, "/homes", READY);
      const box = page.getByRole("combobox", { name: "Search by location" });
      await box.fill("Hartwell");
      const options = page.getByRole("option");
      await expect(options.filter({ hasText: /^Hartwell/ }).first()).toBeVisible();
      await expect(options.filter({ hasText: "Lake Hartwell (lake area)" })).toHaveCount(1);

      await box.fill("Lake Hart");
      await expect(options.filter({ hasText: "Lake Hartwell (lake area)" })).toHaveCount(1);
      await expect(options.filter({ hasText: /Lake Hartwell/ })).toHaveCount(1);
      await options.filter({ hasText: "Lake Hartwell (lake area)" }).click();

      await expect(page).toHaveURL(/\/homes\?q=Lake\+Hartwell/);
      await expect(heading(page)).toHaveText("Homes near Lake Hartwell");
      await expect(box).toHaveValue("Lake Hartwell");
      const towns = new Set(
        (await page.getByTestId("card-address").allTextContents()).map((a) => a.split(", ")[1]),
      );
      expect(
        [...towns].some((t) => t !== "Hartwell"),
        [...towns].join(", "),
      ).toBe(true);
    });
  });

  test.describe("a moved map searches every home in view", () => {
    test.describe.configure({ timeout: 90_000 });

    test("the town gives way to 'Homes in this map area', with a way back", async ({ page }) => {
      await gotoHydrated(page, "/homes?q=Royston", READY);
      await expect(heading(page)).toHaveText("Homes for sale in Royston");
      const royston = await resultCount(page);
      if (phone) await page.getByRole("button", { name: "Map", exact: true }).click();
      const map = page.locator(".maplibregl-map");
      await expect(map).toBeVisible();
      await page.waitForFunction(() => {
        const m = (window as unknown as { __searchMap?: import("maplibre-gl").Map }).__searchMap;
        return !!m && m.loaded() && !m.isMoving();
      });
      // Zoom out first without searching (a programmatic move), so the drag's view takes
      // in the towns around Royston too.
      await page.evaluate(() => {
        const m = (window as unknown as { __searchMap: import("maplibre-gl").Map }).__searchMap;
        m.jumpTo({ zoom: m.getZoom() - 1.5 });
      });
      const box = (await map.boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (phone) {
        await touchDrag(page, center, { x: center.x - 120, y: center.y + 40 });
      } else {
        // Drag the map: a real gesture, so it counts as the buyer moving the map.
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
        await page.mouse.move(center.x - 160, center.y + 40, { steps: 12 });
        await page.mouse.up();
      }
      await expect(page).toHaveURL(/[?&]bounds=/);
      await expect(page).toHaveURL(/[?&]from=Royston(&|$)/);
      expect(new URL(page.url()).searchParams.get("q")).toBeNull();
      if (phone) await page.getByRole("button", { name: "List", exact: true }).click();
      await expect(heading(page)).toHaveText("Homes in this map area");

      // Every home in view, whatever its town: the count matches the database's.
      const [w, s, e, n] = new URL(page.url()).searchParams.get("bounds")!.split(",").map(Number);
      const inView = await count(
        `${FOR_SALE} and property_type <> 'commercial' and longitude between $1 and $2 and latitude between $3 and $4`,
        [w, e, s, n],
      );
      const elsewhere = await count(
        `${FOR_SALE} and property_type <> 'commercial' and city <> 'Royston' and longitude between $1 and $2 and latitude between $3 and $4`,
        [w, e, s, n],
      );
      expect(elsewhere, "the view takes in other towns' homes").toBeGreaterThan(0);
      await expect.poll(() => resultCount(page)).toBe(inView);
      expect(inView).toBeGreaterThan(royston);

      const back = page.getByTestId("back-to-town");
      await expect(back).toHaveText(/Back to Royston/);
      if (phone) await expectTapTargets(page, "[data-testid=back-to-town]");
      await back.click();
      await expect(page).toHaveURL(/\/homes\?q=Royston(&view=map)?$/);
      // Phones stay on the map they were using; the list has the heading.
      if (phone) await page.getByRole("button", { name: "List", exact: true }).click();
      await expect(heading(page)).toHaveText("Homes for sale in Royston");
      expect(await resultCount(page)).toBe(royston);
      await expect(back).toHaveCount(0);
    });

    test("'Back to Royston' survives a reload", async ({ page }) => {
      await gotoHydrated(page, "/homes?bounds=-83.2,34.2,-83.0,34.35&from=Royston", READY);
      await expect(heading(page)).toHaveText("Homes in this map area");
      await page.reload();
      await expect(page.getByTestId("back-to-town")).toHaveText(/Back to Royston/);
      // A saved search never carries it: it is only the way back.
      await expect(page).toHaveTitle(/^Homes in this map area/);
    });
  });

  test.describe("no results is never a dead end", () => {
    test("a town with nothing to rent offers alerts, the state and nearby towns", async ({
      page,
    }) => {
      expect(
        await count(
          `removed_at is null and not idx_hidden and city = 'Carnesville' and transaction_type = 'rent' and status = 'active'`,
        ),
      ).toBe(0);
      await gotoHydrated(page, "/homes?q=Carnesville&mode=rent", READY);
      await expect(heading(page)).toHaveText("Rentals in Carnesville");
      expect(await resultCount(page)).toBe(0);
      const empty = page.getByTestId("no-results");
      await expect(empty).toContainText("Nothing is listed in Carnesville right now.");
      // No filters are on, so there's nothing to clear.
      await expect(empty.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
      await expect(empty.getByRole("link", { name: "See all rentals in Georgia" })).toHaveAttribute(
        "href",
        "/homes?mode=rent",
      );
      await expect(
        empty.getByRole("button", { name: "Email me when homes list here" }),
      ).toBeVisible();

      const nearby = empty.getByRole("navigation", { name: "Nearby towns" }).getByRole("link");
      const n = await nearby.count();
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
      for (const href of await nearby.evaluateAll((els) =>
        els.map((a) => a.getAttribute("href")),
      )) {
        expect(href).toMatch(/^\/homes\?q=[^&]+&mode=rent$/);
        expect(href).not.toContain("Carnesville");
      }
      if (phone) {
        await expectNoHorizontalOverflow(page);
        await expectTapTargets(page, "[data-testid=no-results] a, [data-testid=no-results] button");
      } else {
        // The map goes to the place searched, not the whole state.
        const c = await page.waitForFunction(() => {
          const m = (window as unknown as { __searchMap?: import("maplibre-gl").Map }).__searchMap;
          if (!m || m.isMoving() || !m.loaded()) return null;
          return { ...m.getCenter(), zoom: m.getZoom() };
        });
        const v = (await c.jsonValue()) as { lat: number; lng: number; zoom: number };
        expect(v.zoom).toBeGreaterThan(9);
        expect(Math.abs(v.lat - 34.37)).toBeLessThan(0.15);
        expect(Math.abs(v.lng + 83.24)).toBeLessThan(0.15);
      }

      // A nearby town has rentals.
      const city = (await nearby.first().locator("span").first().textContent())!;
      await nearby.first().click();
      await expect(heading(page)).toHaveText(`Rentals in ${city}`);
      expect(await resultCount(page)).toBeGreaterThan(0);
    });

    test("'Email me when homes list here' saves the search (sign-in first)", async ({ page }) => {
      await gotoHydrated(page, "/homes?q=Carnesville&mode=rent", READY);
      await page.getByRole("button", { name: "Email me when homes list here" }).click();
      await expect(page).toHaveURL(/\/sign-in\?next=.*Carnesville.*&reason=save-search$/);
    });

    test("with filters on, 'Clear filters' clears them all", async ({ page }) => {
      await gotoHydrated(page, "/homes?q=Royston&minPrice=900000000&pool=1", READY);
      expect(await resultCount(page)).toBe(0);
      await page.getByTestId("no-results").getByRole("button", { name: "Clear filters" }).click();
      await expect(page).toHaveURL(/\/homes\?q=Royston$/);
      expect(await resultCount(page)).toBeGreaterThan(0);
    });
  });

  test.describe("commercial stays out; the heading follows the type filter", () => {
    test("the default search leaves commercial out and keeps land in", async ({ page }) => {
      const homes = await count(`${FOR_SALE} and property_type <> 'commercial'`);
      const shops = await count(`${FOR_SALE} and property_type = 'commercial'`);
      const land = await count(`${FOR_SALE} and property_type = 'land'`);
      expect(shops, "the seed has commercial property for sale").toBeGreaterThan(0);
      expect(land, "and land").toBeGreaterThan(0);

      await gotoHydrated(page, "/homes", READY);
      await expect(heading(page)).toHaveText("Homes for sale in Georgia");
      expect(await resultCount(page)).toBe(homes);

      await gotoHydrated(page, "/homes?types=commercial", READY);
      await expect(heading(page)).toHaveText("Commercial property for sale in Georgia");
      expect(await resultCount(page)).toBe(shops);
    });

    test("picking Land makes it 'Land for sale in Georgia'", async ({ page }) => {
      await gotoHydrated(page, "/homes", READY);
      await page.getByRole("button", { name: "Property type" }).click();
      await expect(
        page.getByText("With no type picked, you see every type except commercial."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Land", exact: true }).click();
      await expect(page).toHaveURL(/[?&]types=land(&|$)/);
      await expect(heading(page)).toHaveText("Land for sale in Georgia");
      await expect(page).toHaveTitle(/^Land for sale in Georgia/);
    });
  });

  test.describe("land is land (site review #8)", () => {
    test("land cards show acres and price per acre; land sorts order by them", async ({ page }) => {
      const tract = await biggestTract();
      await gotoHydrated(page, "/homes?types=land&sort=lot_desc", READY);
      const lines = page.getByTestId("card-land");
      await expect(lines.first()).toBeVisible();
      expect(await lines.count()).toBe(await page.locator("article").count());
      const texts = await lines.allTextContents();
      const sized = texts.filter((t) => /acres?/.test(t));
      for (const t of sized) expect(t).toMatch(/^Land · [\d.,]+ acres? · \$[\d,]+\/acre$/);
      // Most acres first, and the first card's numbers are the tract's own.
      const acres = sized.map(acresIn);
      expect(acres).toEqual([...acres].sort((a, b) => b - a));
      expect(texts[0]).toContain(perAcre(tract.price, tract.lot));

      // Price per acre, cheapest first, from the sort menu.
      const sort = page.getByRole("combobox", { name: "Sort results" });
      await expect(sort.locator("option", { hasText: "Acreage (most first)" })).toHaveCount(1);
      await sort.selectOption({ label: "Price per acre" });
      await expect(page).toHaveURL(/[?&]sort=price_per_acre_asc(&|$)/);
      await expect(list(page).locator("article").first()).toBeVisible();
      await expect
        .poll(async () => {
          const values = (await lines.allTextContents())
            .filter((t) => t.includes("/acre"))
            .map(perAcreIn);
          return values.length > 1 && values.every((v, i) => i === 0 || v >= values[i - 1]);
        })
        .toBe(true);
    });

    test("a land page says 'About this property' and estimates a land loan", async ({ page }) => {
      const tract = await biggestTract();
      await gotoHydrated(page, `/homes/${tract.slug}`, "main p.tabular");
      const main = page.locator("main");
      await expect(main.getByRole("heading", { name: "About this property" })).toBeVisible();
      await expect(main.getByRole("heading", { name: "About this home" })).toHaveCount(0);
      const labels = await main.locator("dt").allTextContents();
      for (const houseOnly of ["Year built", "Garage", "Price per sq ft", "Beds", "Baths", "Sq ft"])
        expect(labels, houseOnly).not.toContain(houseOnly);
      const facts = page.getByTestId("big-facts");
      await expect(facts).toContainText("Acreage");
      await expect(facts).toContainText(perAcre(tract.price, tract.lot));
      // No home insurance on bare land, and a land loan is not a home mortgage.
      await expect(page.getByTestId("estimate-pill")).toContainText(
        "Land loan: terms vary; check with your lender",
      );
      const costs = page.locator("#costs");
      await expect(costs).not.toContainText("Home insurance");
      await expect(costs).not.toContainText("Mortgage insurance");
      await expect(page.getByTestId("land-loan-note")).toBeVisible();
      if (phone) {
        await expectNoHorizontalOverflow(page);
        // The phone's bar sums the tract up too.
        await expect(page.locator("[data-cta-bar]")).toContainText(/Land · [\d,.]+ acres/);
      }

      // A house keeps its home wording and insurance.
      await gotoHydrated(page, "/homes?ourListings=1&types=single_family", READY);
      await page.locator("article a[href^='/homes/']").first().click();
      await expect(
        page.locator("main").getByRole("heading", { name: "About this home" }),
      ).toBeVisible();
      await expect(page.locator("#costs")).toContainText("Home insurance");
    });

    test("area market numbers give land's price per acre", async ({ page }) => {
      await gotoHydrated(page, "/areas/carnesville", "main h1");
      const tile = page.getByTestId("market-tile").filter({ hasText: "Median price per acre" });
      await expect(tile).toContainText(/\$[\d,]+/);
      await expect(tile).toContainText(/From \d+ tracts? of land for sale/);
      if (phone) await expectNoHorizontalOverflow(page);
    });

    if (!phone) {
      test("the map preview says 'Land · X acres'", async ({ page }) => {
        const tract = await biggestTract();
        await gotoHydrated(page, `/homes?q=${tract.mls}`, READY);
        expect(await resultCount(page)).toBe(1);
        const point = await page
          .waitForFunction(() => {
            const m = (window as unknown as { __searchMap?: import("maplibre-gl").Map })
              .__searchMap;
            if (!m || m.isMoving() || !m.loaded()) return null;
            const [f] = m.queryRenderedFeatures({ layers: ["pins", "pin-dots"] });
            if (!f) return null;
            const p = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
            const r = m.getCanvas().getBoundingClientRect();
            return { x: r.left + p.x, y: r.top + p.y };
          })
          .then((h) => h.jsonValue() as Promise<{ x: number; y: number }>);
        await page.mouse.click(point.x, point.y);
        const preview = page.locator(".maplibregl-popup");
        await expect(preview).toContainText(/Land · [\d,.]+ acres/);
        await expect(preview).toContainText(perAcre(tract.price, tract.lot));
        await expect(preview).not.toContainText("bd");
      });

      test("the lot size is typed in acres, with a switch to square feet", async ({ page }) => {
        const street = `${Date.now() % 100000} E2E Acreage Rd`;
        await signIn(page, "admin@adamsrealty.example", "/dashboard");
        await page.goto("/dashboard/listings/new");
        const lot = page.locator("#lotSize");
        const acres = page.getByRole("radio", { name: "Acres" });
        const sqft = page.getByRole("radio", { name: "Sq ft" });
        await expect(acres).toBeChecked();
        await lot.fill("2.5");
        await sqft.check();
        await expect(lot).toHaveValue("108900");
        await acres.check();
        await expect(lot).toHaveValue("2.5");

        await page.selectOption("#status", "active");
        await page.selectOption("#propertyType", "land");
        await page.fill("#listPrice", "125000");
        await page.fill("#addressLine1", street);
        await page.fill("#city", "Royston");
        await page.fill("#postalCode", "30662");
        await page.fill("#latitude", "34.2891");
        await page.fill("#longitude", "-83.1131");
        await lot.fill("12.5");
        await page.getByRole("button", { name: "Create listing" }).click();
        await expect(page).toHaveURL(/\/dashboard\/listings\/[0-9a-f-]+\?created=1/);

        const stored = await withDb((db) =>
          db
            .query<{ lot: number }>(
              "select lot_size_sqft as lot from listings where address_line1 = $1",
              [street],
            )
            .then((r) => r.rows[0].lot),
        );
        expect(stored).toBe(12.5 * ACRE);
        // The editor shows it back in acres.
        await page.reload();
        await expect(page.locator("#lotSize")).toHaveValue("12.5");
        await expect(page.getByRole("radio", { name: "Acres" })).toBeChecked();

        // Clean up so reruns stay tidy.
        page.once("dialog", (d) => d.accept());
        await page.getByRole("button", { name: "Delete listing" }).click();
        await expect(page).toHaveURL(/\/dashboard\/listings$/);
      });
    }
  });
}
