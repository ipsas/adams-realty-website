import type { Page } from "@playwright/test";
import {
  DARK_AXE_PHONE_PAGES,
  DARK_CANVAS,
  LIGHT_CANVAS,
  LIGHT_INK,
  SYSTEM_DARK_PAGES,
  canvas,
  darkAxeSuite,
  dataTheme,
  expectListingPrintsLight,
  firstThemeColor,
  stored,
} from "../theme-suite";
import { expect, expectTapTargets, gotoHydrated, test } from "./helpers";

/*
 * Dark mode on phones and tablets. The switch tests are tagged @landscape, so they run on
 * pixel7, iphone13, iphone13-landscape and ipad-mini: the phone menu's Appearance control
 * must be reachable on each, and the header's sun/moon button must not show on any of them.
 * The dark axe matrix (untagged) runs on pixel7 and iphone13. Shared helpers: ../theme-suite.ts.
 */

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
    expect((await firstThemeColor(page)).content).toBe("#0f1412");
    expect(await stored(page)).toBe('"dark"');

    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(await dataTheme(page)).toBe("dark");
    expect(await canvas(page)).toBe(DARK_CANVAS);

    // A client-side navigation from the phone menu keeps it (same document: the marker stays).
    await page.evaluate(() => ((window as unknown as { __sameDoc: boolean }).__sameDoc = true));
    await openMenu(page);
    await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Buy" }).tap();
    await expect(page).toHaveURL(/\/homes$/);
    await expect(page.locator("[aria-live=polite]")).toBeAttached();
    expect(
      await page.evaluate(() => (window as unknown as { __sameDoc?: boolean }).__sameDoc),
    ).toBe(true);
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

    // Auto follows the device live.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => canvas(page)).toBe(DARK_CANVAS);
    expect(await dataTheme(page)).toBeNull();
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => canvas(page)).toBe(LIGHT_CANVAS);
  },
);

test(
  "a forced Light stays light on a dark device, and printing is light in Dark",
  { tag: "@landscape" },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoHydrated(page, "/about", "header button");
    expect(await canvas(page)).toBe(DARK_CANVAS);
    const group = await openMenu(page);
    const light = group.getByRole("radio", { name: "Light" });
    await light.scrollIntoViewIfNeeded();
    await light.tap();
    expect(await dataTheme(page)).toBe("light");
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
    expect(await firstThemeColor(page)).toEqual({ content: "#fbfaf7", media: null });

    const dark = group.getByRole("radio", { name: "Dark" });
    await dark.tap();
    expect(await canvas(page)).toBe(DARK_CANVAS);
    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
    expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(LIGHT_INK);
  },
);

test("a listing printed in Dark prints light, its location map included", async ({ page }) => {
  test.setTimeout(90_000);
  await expectListingPrintsLight(page);
});

/* ───────────────────────── the dark axe matrix ───────────────────────── */

darkAxeSuite(test, { pages: DARK_AXE_PHONE_PAGES, systemPages: SYSTEM_DARK_PAGES });
