import type { Page } from "@playwright/test";
import { expect, expectTapTargets, gotoHydrated, test } from "./helpers";

/*
 * Dark mode on phones and tablets (DM3). Tagged @landscape, so it runs on pixel7, iphone13,
 * iphone13-landscape and ipad-mini: the phone menu's Appearance control must be reachable
 * on each, and the header's sun/moon button must not show on any of them.
 */

const KEY = "ar:theme";
const DARK_CANVAS = "rgb(15, 20, 18)";
const LIGHT_CANVAS = "rgb(251, 250, 247)";

const dataTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const canvas = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const firstThemeColor = (page: Page) =>
  page.evaluate(
    () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null,
  );
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Open menu" }).click();
  const group = page.getByRole("group", { name: "Appearance" });
  await expect(group).toBeAttached();
  return group;
}

test(
  "the phone menu's Appearance control is reachable, 44px, and switches the theme",
  { tag: "@landscape" },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await gotoHydrated(page, "/about", "header button");
    // Phones get no sun/moon button in the header.
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeHidden();

    const group = await openMenu(page);
    const dark = group.getByRole("radio", { name: "Dark" });
    await dark.scrollIntoViewIfNeeded();
    await expect(dark).toBeInViewport();
    await expect(group.getByRole("radio", { name: "Auto (match my device)" })).toBeChecked();
    // Each option (its radio covers it) is a 44px target.
    expect(await expectTapTargets(page, "[data-appearance=segmented] input[type=radio]")).toBe(3);

    await dark.tap();
    await expect(dark).toBeChecked();
    expect(await dataTheme(page)).toBe("dark");
    expect(await canvas(page)).toBe(DARK_CANVAS);
    expect(await firstThemeColor(page)).toBe("#0f1412");
    expect(await stored(page)).toBe('"dark"');

    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(await dataTheme(page)).toBe("dark");
    expect(await canvas(page)).toBe(DARK_CANVAS);

    const again = await openMenu(page);
    const auto = again.getByRole("radio", { name: "Auto (match my device)" });
    await expect(again.getByRole("radio", { name: "Dark" })).toBeChecked();
    await auto.scrollIntoViewIfNeeded();
    await auto.tap();
    await expect(auto).toBeChecked();
    expect(await dataTheme(page)).toBeNull();
    expect(await stored(page)).toBeNull();
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
    expect(await page.locator("#theme-color-override").count()).toBe(0);
  },
);
