import { type Page, expect, test } from "@playwright/test";

/*
 * Light mode must look exactly as it did before dark mode (docs/plans/dark-mode-and-georgia.md,
 * review correction 10). The baselines in theme-light-regression.spec.ts-snapshots/ were taken
 * from the commit before DM1 (7cc2d26), served on another port with this same spec and
 * `--update-snapshots`, and any pixel difference fails.
 *
 * Only pages whose content doesn't depend on the clock or on data other e2e suites write:
 * listing pages show "Updated 3 hours ago" and the home page's newest listings move as tests
 * add some. Photos are masked (they load lazily), and so are the footer's town links, which
 * are the busiest towns in the listings (GA-A) and shift as tests add homes. The one element
 * dark mode added to a light page, the header's Appearance button, is taken out before the
 * capture.
 *
 * A change that is meant to alter light mode updates the baselines in the same commit:
 * `npx playwright test e2e/theme-light-regression.spec.ts --project=desktop --update-snapshots`.
 */

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });

const PAGES = ["/sign-in", "/about", "/contact", "/sell", "/fair-housing"];

async function withoutThemeButton(page: Page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("header button")].find(
      (b) => b.textContent?.trim() === "Appearance",
    );
    // Its wrapper is the flex item: removing it removes its gap too, as before DM3.
    button?.parentElement?.remove();
  });
}

for (const path of PAGES) {
  test(`light ${path} is unchanged since before dark mode`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(
      null,
    );
    await withoutThemeButton(page);
    await expect(page).toHaveScreenshot(`${path.slice(1).replaceAll("/", "-")}.png`, {
      fullPage: true,
      mask: [
        page.locator("img, picture, canvas, video"),
        page.locator("footer [data-footer-column='Places'] a[href^='/homes?q=']"),
      ],
      animations: "disabled",
      caret: "hide",
      // Exact: the default per-pixel threshold (0.2) would let a small colour change through.
      threshold: 0,
      maxDiffPixels: 0,
    });
  });
}
