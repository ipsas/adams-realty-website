import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("anonymous save prompts sign-in", async ({ page }) => {
  await page.goto("/homes");
  await page.waitForLoadState("networkidle");
  await page.locator('article button[aria-label="Save home"]').first().click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
});

test("buyer can save a home and see it on the saved page", async ({ page }) => {
  await signIn(page, "buyer@example.com", "/homes?sort=newest");
  await page.waitForLoadState("networkidle"); // make sure the page has hydrated before clicking
  const card = page.locator("article").first();
  const save = card.locator("button[aria-pressed]");
  const address = (await card.getByTestId("card-address").textContent())!.split(",")[0];
  if ((await save.getAttribute("aria-pressed")) === "false") {
    // Wait for the server action to finish before navigating away.
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.ok());
    await save.click();
    await saved;
  }
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await page.goto("/saved");
  await expect(page.getByText(address).first()).toBeVisible();
});

test("tour requests reach the listing agent", async ({ page }) => {
  await page.goto("/homes?ourListings=1");
  await page.locator("article a").first().click();
  await page.fill("#c-name", "E2E Tester");
  await page.fill("#c-email", "e2e@example.com");
  await page.getByRole("button", { name: "Send tour request" }).click();
  await expect(page.getByText(/Request sent!/)).toBeVisible();
});

test("buyers are kept out of the dashboard", async ({ page }) => {
  await signIn(page, "buyer@example.com", "/");
  const res = await page.goto("/dashboard");
  expect(res?.status()).toBe(403);
});

test("signed-out visitors are sent to sign-in from account pages", async ({ page }) => {
  await page.goto("/dashboard/leads");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard%2Fleads/);
});
