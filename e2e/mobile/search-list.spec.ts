import { expect, gotoHydrated, test } from "./helpers";

/*
 * The /homes results list below lg, where the List/Map toggle floats over it (fixed,
 * bottom-6). The Georgia MLS notice closes the list, and the IDX rules require it to be
 * readable, so the list pads its end to clear the toggle. Tagged @landscape: the toggle also
 * shows on landscape phones and small tablets.
 */

for (const colorScheme of ["light", "dark"] as const) {
  test(
    `the Georgia MLS notice at the end of the list is never under the Map button (${colorScheme})`,
    { tag: "@landscape" },
    async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await gotoHydrated(page, "/homes", "[aria-live=polite]");
      const list = page.locator("[data-results-list]");
      const toggle = page.getByRole("button", { name: "Map", exact: true });
      const notice = list.locator("[data-mls-disclaimer]");
      const attribution = list.locator("[data-mls-attribution]");
      await expect(toggle).toBeVisible();
      await expect(notice).toContainText("Information deemed reliable but not guaranteed.");

      // Scroll the list to its very end.
      await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await expect
        .poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
        .toBeLessThanOrEqual(1);

      const button = (await toggle.boundingBox())!;
      for (const [name, block] of [
        ["disclaimer", notice],
        ["attribution", attribution],
      ] as const) {
        await expect(block).toBeInViewport();
        const box = (await block.boundingBox())!;
        expect(box.y + box.height, `${name} ends above the Map button`).toBeLessThanOrEqual(
          button.y,
        );
      }
    },
  );
}
