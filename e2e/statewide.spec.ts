import { expect, test, type Page } from "@playwright/test";

/** The statewide demo feed (STATEWIDE_AREAS in scripts/seed-data.ts). */

async function resultCount(page: Page): Promise<number> {
  const live = page.locator("[aria-live=polite]");
  await expect(live).toContainText(/\d+ results?/);
  const text = (await live.textContent()) ?? "";
  return Number(text.match(/([\d,]+) results?/)![1].replace(/,/g, ""));
}

test("a Decatur search fills a page with Decatur homes", async ({ page }) => {
  await page.goto("/homes?q=Decatur");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Homes for sale in Decatur/);
  expect(await resultCount(page)).toBeGreaterThanOrEqual(10);
  const addresses = await page.getByTestId("card-address").allTextContents();
  expect(addresses.length).toBeGreaterThanOrEqual(10);
  for (const a of addresses) expect(a).toMatch(/Decatur, GA 30\d{3}$/);
});

test("Virginia-Highland listings are Atlanta homes in the neighborhood", async ({ page }) => {
  await page.goto("/homes?q=Virginia-Highland");
  expect(await resultCount(page)).toBeGreaterThanOrEqual(1);
  const addresses = await page.getByTestId("card-address").allTextContents();
  for (const a of addresses) expect(a).toMatch(/Atlanta, GA 30\d{3}$/);
  await page.locator("article a").first().click();
  await expect(page).toHaveURL(/\/homes\/[a-z0-9-]+$/);
  await expect(page.getByRole("link", { name: "Virginia-Highland" }).first()).toBeVisible();
});

test("statewide listings belong to other brokerages, never Adams Realty", async ({ page }) => {
  await page.goto("/homes?q=Savannah");
  expect(await resultCount(page)).toBeGreaterThanOrEqual(1);
  const offices = await page.getByText(/^Listing by /).allTextContents();
  expect(offices.length).toBeGreaterThan(0);
  for (const o of offices) expect(o).not.toContain("Adams Realty");

  await page.goto("/homes?q=Savannah&ourListings=1");
  expect(await resultCount(page)).toBe(0);
});

// Real feeds keep the subdivision in `neighborhood` and the lake only in
// WaterBodyName (LAKE_FIXTURES in scripts/seed-data.ts). Each price is unique
// in the seed, so the price filter narrows the search to that one home.
for (const f of [
  { q: "Lake Hartwell", price: 612345, street: "118 Cedar Cove Court" },
  { q: "Lake Lanier", price: 734567, street: "412 Harbour Point Drive" },
  { q: "Lake Sinclair", price: 456789, street: "27 Twin Oaks Trail" },
]) {
  test(`a ${f.q} search finds a home that names the lake only in WaterBodyName`, async ({
    page,
  }) => {
    const qs = new URLSearchParams({
      q: f.q,
      minPrice: String(f.price),
      maxPrice: String(f.price),
    });
    await page.goto(`/homes?${qs}`);
    expect(await resultCount(page)).toBe(1);
    await expect(page.getByTestId("card-address").first()).toContainText(f.street);
  });
}

// STATEWIDE_LAKES in scripts/seed-data.ts: middle Georgia's lakes, with no area guide.
for (const lake of ["Lake Oconee", "Lake Sinclair"]) {
  test(`a ${lake} search finds homes on and around the lake`, async ({ page }) => {
    await page.goto(`/homes?${new URLSearchParams({ q: lake })}`);
    expect(await resultCount(page)).toBeGreaterThanOrEqual(3);
    const addresses = await page.getByTestId("card-address").allTextContents();
    for (const a of addresses) expect(a).toMatch(/, GA 3\d{4}$/);
  });
}

test("the location box matches places, not words in descriptions", async ({ page }) => {
  // 64 seeded homes for sale have "quartz" in their description (it used to
  // match); no address, town, ZIP, subdivision or lake does. Keyword search
  // over descriptions is a separate filter (WP4's `kw`).
  await page.goto("/homes?q=quartz");
  expect(await resultCount(page)).toBe(0);
  // A place still does.
  await page.goto("/homes?q=Decatur");
  expect(await resultCount(page)).toBeGreaterThanOrEqual(10);
});
