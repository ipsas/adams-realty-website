import { expect, type Page } from "@playwright/test";

export const PASSWORD = process.env.SEED_PASSWORD ?? "adams-demo-2026";

export async function signIn(page: Page, email: string, next = "/") {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, "\\$&")}$`));
}

/**
 * The public forms flag anything sent within a few seconds of the form appearing
 * (src/lib/spam.ts, MIN_FILL_MS): before sending, take as long as a person would.
 */
export async function waitLikeAPerson(page: Page, ms = 3_300) {
  await page.waitForTimeout(ms);
}
