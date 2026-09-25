import { expect, test } from "@playwright/test";

test("home page shows live market stats and featured homes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Homes worth");
  await expect(page.locator("article").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("search is URL-driven and filters results", async ({ page }) => {
  await page.goto("/homes?q=Royston&beds=3");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Homes for sale in Royston/);
  await expect(page.locator("[aria-live=polite]")).toContainText(/\d+ results?/);
  const addresses = await page.getByTestId("card-address").allTextContents();
  expect(addresses.length).toBeGreaterThan(0);
  for (const a of addresses) expect(a).toContain("Royston, GA 30662");
});

test("property type filter finds commercial listings", async ({ page }) => {
  await page.goto("/homes?types=commercial&mode=rent");
  await expect(page.locator("[aria-live=polite]")).toContainText(/\d+ results?/);
  const cards = page.locator("article");
  await expect(cards.first()).toBeVisible();
  await cards.first().locator("a").first().click();
  await expect(page).toHaveURL(/\/homes\/[a-z0-9-]+$/);
  await expect(page.locator("main")).toContainText(
    /Retail|Office|Mixed Use|Restaurant|Warehouse|Industrial/,
  );
});

test("location autocomplete suggests lakes and towns", async ({ page }) => {
  await page.goto("/homes");
  const box = page.getByRole("combobox", { name: "Search by location" });
  await box.fill("Lake Hart");
  await expect(page.getByRole("option", { name: /Lake Hartwell/ }).first()).toBeVisible();
  await box.fill("Flowery");
  await expect(page.getByRole("option", { name: /Flowery Branch/ }).first()).toBeVisible();
});

test("area guides are grouped by county and link to a town guide", async ({ page }) => {
  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 2, name: "Franklin County" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Lake Hartwell & Hart County" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /^Royston/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/areas\/royston$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Royston");
  await expect(page.getByText("Andrea Anderegg").first()).toBeVisible();
});

test("property page has price, costs, attribution and structured data", async ({ page }) => {
  await page.goto("/homes?ourListings=1");
  await page.locator("article a").first().click();
  await expect(page).toHaveURL(/\/homes\/[a-z0-9-]+$/);
  await expect(page.locator("main p.tabular").first()).toContainText("$");
  await expect(page.getByText(/^Listed by /)).toBeVisible();
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(jsonLd!)["@type"]).toBe("RealEstateListing");
});

test("unknown listing returns 404", async ({ page }) => {
  const res = await page.goto("/homes/does-not-exist-0000000");
  expect(res?.status()).toBe(404);
});
