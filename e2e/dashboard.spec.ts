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
  await page.fill("#city", "Royston");
  await page.fill("#postalCode", "30662");
  await page.fill("#latitude", "34.2871");
  await page.fill("#longitude", "-83.1101");
  await page.getByRole("button", { name: "Create listing" }).click();
  await expect(page).toHaveURL(/\/dashboard\/listings\/[0-9a-f-]+\?created=1/);

  await page.goto(`/homes?q=${encodeURIComponent(street)}`);
  await expect(page.locator("article").first()).toContainText(street);

  // Clean up so reruns stay tidy.
  await page.goto("/dashboard/listings");
  await page
    .getByRole("row", { name: new RegExp(street) })
    .getByRole("link", { name: "Edit" })
    .click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete listing" }).click();
  await expect(page).toHaveURL(/\/dashboard\/listings$/);
});

test("the firm's own listings in a hidden status leave the public site but stay in the dashboard", async ({
  page,
}) => {
  const street = `${Date.now() % 100000} E2E Hidden Oak Ct`;
  const search = `/homes?pending=1&q=${encodeURIComponent(street)}`;
  await signIn(page, "admin@adamsrealty.example", "/dashboard");
  await page.goto("/dashboard/listings/new");
  await page.selectOption("#status", "active");
  await page.fill("#listPrice", "437000");
  await page.fill("#addressLine1", street);
  await page.fill("#city", "Royston");
  await page.fill("#postalCode", "30662");
  await page.fill("#latitude", "34.2861");
  await page.fill("#longitude", "-83.1121");
  await page.getByRole("button", { name: "Create listing" }).click();
  await expect(page).toHaveURL(/\/dashboard\/listings\/[0-9a-f-]+\?created=1/);
  const editUrl = page.url().replace(/\?.*$/, "");
  const publicHref = await page
    .getByRole("link", { name: "View public page" })
    .getAttribute("href");
  expect(publicHref).toMatch(/^\/homes\//);

  // Active: public.
  await page.goto(search);
  await expect(page.locator("article").first()).toContainText(street);

  for (const [status, label] of [
    ["coming_soon", "Coming soon"],
    ["withdrawn", "Withdrawn"],
    ["expired", "Expired"],
    ["canceled", "Canceled"],
  ]) {
    await page.goto(editUrl);
    await page.selectOption("#status", status);
    await expect(page.getByTestId("status-not-public")).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Listing saved.")).toBeVisible();

    // Off the public site: no search result, no page.
    await page.goto(search);
    await expect(page.locator("[aria-live=polite]")).toContainText(/No homes|0 results/);
    await expect(page.locator("article")).toHaveCount(0);
    const res = await page.goto(publicHref!);
    expect(res?.status(), status).toBe(404);

    // Still in the dashboard, with its status, for staff to manage.
    await page.goto("/dashboard/listings");
    const row = page.getByRole("row", { name: new RegExp(street) });
    await expect(row).toContainText(label);
    await expect(row.getByTestId("not-public")).toBeVisible();
    await expect(row.getByRole("link", { name: "View" })).toHaveCount(0);
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await page.goto(editUrl);
    await expect(page.getByTestId("not-public")).toBeVisible();
  }

  // Clean up so reruns stay tidy.
  await page.goto(editUrl);
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
