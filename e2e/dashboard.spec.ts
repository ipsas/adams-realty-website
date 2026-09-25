import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("agents see only their own listings and no admin tools", async ({ page }) => {
  await signIn(page, "daniel@adamsrealty.example", "/dashboard");
  await page.goto("/dashboard/listings");
  await expect(page.getByRole("link", { name: "Users & roles" })).toHaveCount(0);
  const agentCells = page.locator("tbody tr");
  expect(await agentCells.count()).toBeGreaterThan(0);
  const res = await page.goto("/dashboard/users");
  expect(res?.status()).toBe(403);
});

test("admins can create a listing that appears in public search", async ({ page }) => {
  const street = `${Date.now() % 100000} E2E Dogwood Ln`;
  await signIn(page, "admin@adamsrealty.example", "/dashboard");
  await page.goto("/dashboard/listings/new");
  await page.selectOption("#status", "active");
  await page.fill("#listPrice", "515000");
  await page.fill("#addressLine1", street);
  await page.fill("#city", "Decatur");
  await page.fill("#postalCode", "30030");
  await page.fill("#latitude", "33.77");
  await page.fill("#longitude", "-84.29");
  await page.getByRole("button", { name: "Create listing" }).click();
  await expect(page).toHaveURL(/\/dashboard\/listings\/[0-9a-f-]+\?created=1/);

  await page.goto(`/homes?q=${encodeURIComponent(street)}`);
  await expect(page.locator("article").first()).toContainText(street);

  // Clean up so reruns stay tidy.
  await page.goto("/dashboard/listings");
  await page.getByRole("row", { name: new RegExp(street) }).getByRole("link", { name: "Edit" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete listing" }).click();
  await expect(page).toHaveURL(/\/dashboard\/listings$/);
});

test("admins cannot change their own role", async ({ page }) => {
  await signIn(page, "admin@adamsrealty.example", "/dashboard");
  await page.goto("/dashboard/users");
  const ownRow = page.getByRole("row", { name: /admin@adamsrealty\.example/ });
  await expect(ownRow.getByRole("combobox", { name: "Role" })).toBeDisabled();
});
