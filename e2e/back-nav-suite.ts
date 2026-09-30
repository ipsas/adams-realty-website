import { type Locator, type Page, expect, type test as baseTest } from "@playwright/test";
import { signIn } from "./helpers";
import { gotoHydrated, historyLength, waitForHydration, withDb } from "./mobile/helpers";

/*
 * Getting back to where you were (site review #1 and #2, docs/plans/site-review-2026-09-29.md):
 * Back and "Back to results" from a home, the photo viewer, filter history, the heart's
 * sign-in round trip, the dashboard's "All leads" and "Back to listings", and the listing's
 * call-to-action bar and agent phone. e2e/back-nav.spec.ts runs it on desktop and
 * e2e/mobile/back-nav.spec.ts on pixel7 and iphone13. Not a spec file itself.
 */

const READY = "[aria-live=polite]";
const list = (page: Page) => page.locator("[data-results-list]");

async function openResults(page: Page, url = "/homes") {
  await gotoHydrated(page, url, READY);
  await expect(list(page).locator("article").nth(9)).toBeAttached();
}

/** Scrolls the list so the 10th card sits a little below its top; returns what was tapped. */
async function scrollToTenth(page: Page) {
  const card = list(page).locator("article").nth(9);
  const link = card.locator("a[href^='/homes/']").first();
  const href = (await link.getAttribute("href"))!;
  await list(page).evaluate((el, i) => {
    const target = el.querySelectorAll("article")[i] as HTMLElement;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    el.scrollTop += top - 60;
  }, 9);
  await expect.poll(() => cardOffset(page, href)).toBeLessThan(80);
  const scrollTop = await list(page).evaluate((el) => el.scrollTop);
  expect(scrollTop, "the 10th card is well down the list").toBeGreaterThan(400);
  return { href, scrollTop, offset: await cardOffset(page, href), link };
}

/** Where the card linking to `href` sits, relative to the top of the results list. */
function cardOffset(page: Page, href: string) {
  return list(page).evaluate((el, h) => {
    const a = el.querySelector(`article a[href="${h}"]`);
    const card = a?.closest("article");
    if (!card) return Number.NaN;
    return card.getBoundingClientRect().top - el.getBoundingClientRect().top;
  }, href);
}

async function expectSamePlace(
  page: Page,
  before: { href: string; scrollTop: number; offset: number },
) {
  await expect(page).toHaveURL(/\/homes(\?|$)/);
  await waitForHydration(page, READY);
  await expect
    .poll(() => list(page).evaluate((el) => el.scrollTop), { message: "scroll position" })
    .toBeGreaterThan(before.scrollTop - 50);
  const scrollTop = await list(page).evaluate((el) => el.scrollTop);
  expect(Math.abs(scrollTop - before.scrollTop), "scrollTop within 50px").toBeLessThanOrEqual(50);
  const offset = await cardOffset(page, before.href);
  expect(Math.abs(offset - before.offset), "the same card, within 50px").toBeLessThanOrEqual(50);
  await expect(list(page).locator(`article a[href="${before.href}"]`)).toBeInViewport();
}

async function openCard(link: Locator, page: Page, href: string) {
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator("main p.tabular").first()).toBeVisible();
}

/** A listing with a tour offer and a listing agent (the firm's own). */
async function firmListing(page: Page) {
  await page.goto("/homes?ourListings=1");
  const href = await page.locator("article a[href^='/homes/']").first().getAttribute("href");
  expect(href).toMatch(/^\/homes\/[\w-]+$/);
  return href!;
}

export function backNavSuite(test: typeof baseTest, { phone }: { phone: boolean }) {
  test.describe("getting back to the results", () => {
    test.describe.configure({ timeout: 90_000 });

    test("Back from the 10th card lands on the same card, at the same scroll", async ({ page }) => {
      await openResults(page);
      const before = await scrollToTenth(page);
      await openCard(before.link, page, before.href);
      await page.goBack();
      await expectSamePlace(page, before);
      // The card they looked at is outlined for a moment, and has focus.
      const card = list(page).locator("article", { has: page.locator(`a[href="${before.href}"]`) });
      await expect(card).toHaveAttribute("data-returned", "");
      await expect(card.locator(`a[href="${before.href}"]`)).toBeFocused();
      await expect(card).not.toHaveAttribute("data-returned", { timeout: 5_000 });
    });

    test("'Back to results' acts like Back, and the place survives reloads", async ({ page }) => {
      await page.goto("/about");
      await openResults(page);
      const before = await scrollToTenth(page);
      const length = await historyLength(page);
      await openCard(before.link, page, before.href);

      const back = page.getByRole("link", { name: "Back to results" });
      await expect(back).toHaveAttribute("data-return-mode", "back");
      // Top left of the page.
      const box = (await back.boundingBox())!;
      expect(box.x).toBeLessThan(40);
      await back.click();
      await expectSamePlace(page, before);
      expect(await historyLength(page), "went back, not forward").toBe(length + 1);
      await page.goBack();
      await expect(page).toHaveURL(/\/about$/);

      // A full reload of the results page puts the list back too.
      await page.goForward();
      await expectSamePlace(page, before);
      await page.reload();
      await expectSamePlace(page, before);

      // So does Back to a results page that has to load again (the listing was reloaded).
      await openCard(list(page).locator(`article a[href="${before.href}"]`), page, before.href);
      await page.reload();
      const again = page.getByRole("link", { name: "Back to results" });
      await waitForHydration(page, "main p.tabular");
      await expect(again, "the listing's history entry remembers").toHaveAttribute(
        "data-return-mode",
        "back",
      );
      await again.click();
      await expectSamePlace(page, before);
    });

    test("from a shared link, 'Back to results' goes to the last search", async ({ page }) => {
      const listing = await firmListing(page);
      // Nothing searched in this tab or device yet: the plain search.
      await gotoHydrated(page, listing, "main p.tabular");
      await page.context().clearCookies();
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload();
      await waitForHydration(page, "main p.tabular");
      const back = page.getByRole("link", { name: "Back to results" });
      await expect(back).toHaveAttribute("href", "/homes");

      await openResults(page, "/homes?q=Royston&beds=2");
      await gotoHydrated(page, listing, "main p.tabular");
      await expect(back).toHaveAttribute("data-return-mode", "last");
      await expect(back).toHaveAttribute("href", "/homes?q=Royston&beds=2");
      await back.click();
      await expect(page).toHaveURL(/\/homes\?q=Royston&beds=2$/);
    });

    test("filter taps replace the history entry; a new page of results adds one", async ({
      page,
    }) => {
      await page.goto("/about");
      await openResults(page);
      const length = await historyLength(page);
      const sort = page.getByRole("combobox", { name: "Sort results" });
      await sort.selectOption("price_asc");
      await expect(page).toHaveURL(/sort=price_asc/);
      await sort.selectOption("newest");
      await expect(page).toHaveURL(/sort=newest/);
      expect(await historyLength(page)).toBe(length);

      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page).toHaveURL(/page=2/);
      expect(await historyLength(page)).toBe(length + 1);
      await page.goBack();
      await expect(page).toHaveURL(/\/homes\?sort=newest$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/about$/);
    });
  });

  if (phone) {
    test.describe("map mode", () => {
      test.describe.configure({ timeout: 90_000 });

      test("a home opened from the map comes Back to the map", async ({ page }) => {
        await openResults(page, "/homes?q=Royston");
        await page.getByRole("button", { name: "Map", exact: true }).click();
        const map = page.locator(".maplibregl-map");
        await expect(map).toBeVisible();
        await expect(page).toHaveURL(/[?&]view=map/);
        // Tap the first single pin the map draws; its preview opens the home.
        const point = await page
          .waitForFunction(() => {
            const m = (window as unknown as { __searchMap?: import("maplibre-gl").Map })
              .__searchMap;
            if (!m || m.isMoving() || !m.loaded()) return null;
            const [f] = m.queryRenderedFeatures({ layers: ["pins", "pin-dots"] });
            if (!f) return null;
            const p = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
            const r = m.getCanvas().getBoundingClientRect();
            return { x: r.left + p.x, y: r.top + p.y };
          })
          .then((h) => h.jsonValue() as Promise<{ x: number; y: number }>);
        await page.mouse.click(point.x, point.y);
        const preview = page.locator(".maplibregl-popup a[href^='/homes/']");
        await expect(preview).toBeVisible();
        const href = (await preview.getAttribute("href"))!;
        await preview.click();
        await expect(page).toHaveURL(new RegExp(`${href}$`));
        await expect(page.locator("main p.tabular").first()).toBeVisible();

        await page.goBack();
        await expect(page).toHaveURL(/\/homes\?q=Royston&(.+&)?view=map$/);
        await expect(map).toBeVisible();
        await expect(list(page)).toBeHidden();
        // And after a reload.
        await page.reload();
        await waitForHydration(page, READY);
        await expect(page.locator(".maplibregl-map")).toBeVisible();
        await expect(list(page)).toBeHidden();
        // Back to the list: the toggle drops the map from the URL.
        await page.getByRole("button", { name: "List", exact: true }).click();
        await expect(list(page)).toBeVisible();
        await expect(page).toHaveURL(/\/homes\?q=Royston/);
        expect(page.url()).not.toContain("view=map");
      });
    });
  }

  test.describe("a home's page", () => {
    test("Back closes the photo viewer first", async ({ page }) => {
      await page.goto("/about");
      const listing = await firmListing(page);
      await gotoHydrated(page, listing, "main p.tabular");
      const viewer = page.locator("dialog[open]");
      await page.getByRole("button", { name: /^Open photo 1 of/ }).click();
      await expect(viewer).toBeVisible();
      await page.goBack();
      await expect(viewer).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${listing}$`));

      // Closing it with its button leaves no extra Back step behind.
      await page.getByRole("button", { name: /^Open photo 1 of/ }).click();
      await expect(viewer).toBeVisible();
      await page.getByRole("button", { name: "Close photos" }).click();
      await expect(viewer).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => (history.state as { __dialog?: string })?.__dialog))
        .toBeUndefined();
      await page.goBack();
      await expect(page).toHaveURL(/\/homes\?ourListings=1$/);
    });

    test("the listing agent's phone number dials", async ({ page }) => {
      await gotoHydrated(page, await firmListing(page), "main p.tabular");
      const phone = page.getByTestId("agent-phone");
      await expect(phone).toHaveAttribute("href", /^tel:\+1\d{10}$/);
      await expect(phone).toContainText(/\d{3}.*\d{4}/);
    });

    if (phone) {
      test("the bottom bar leads to the tour form and hides while the form is on screen", async ({
        page,
      }) => {
        await gotoHydrated(page, await firmListing(page), "main p.tabular");
        const bar = page.locator("[data-cta-bar]");
        await expect(bar).toHaveAttribute("data-state", "visible");
        await bar.getByRole("link", { name: "Request a tour" }).click();
        await expect(page.locator("#c-name")).toBeFocused();
        await expect(bar).toHaveAttribute("data-state", "hidden");
        const send = page.getByRole("button", { name: "Send tour request" });
        await send.scrollIntoViewIfNeeded();
        await expect(send).toBeInViewport();
        await expect(bar).toHaveAttribute("data-state", "hidden");
        // Hidden means gone: below the screen and out of the tab order.
        await expect
          .poll(async () => (await bar.boundingBox())!.y)
          .toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);
        await expect(bar).toHaveAttribute("inert", "");

        // Back at the top, the bar returns.
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(bar).toHaveAttribute("data-state", "visible");
      });
    }
  });

  test.describe("signing in from a heart", () => {
    test.describe.configure({ timeout: 90_000 });

    test("keeps the search and saves the home", async ({ page }) => {
      await openResults(page, "/homes?q=Royston");
      const card = list(page).locator("article").nth(2);
      const href = (await card.locator("a[href^='/homes/']").first().getAttribute("href"))!;
      const slug = href.split("/").pop()!;
      const unsave = () =>
        withDb((db) =>
          db.query(
            `delete from saved_listings where listing_id = (select id from listings where slug = $1)
               and user_id = (select id from users where email = 'buyer@example.com')`,
            [slug],
          ),
        );
      await unsave();
      try {
        await card.getByRole("button", { name: "Save home" }).click();
        await expect(page).toHaveURL(/\/sign-in\?next=.*reason=save/);
        const next = new URL(page.url()).searchParams.get("next")!;
        expect(next).toMatch(/^\/homes\?q=Royston&save=[0-9a-f-]{36}$/);

        await page.fill("#email", "buyer@example.com");
        await page.fill("#password", process.env.SEED_PASSWORD ?? "adams-demo-2026");
        await page.click("button[type=submit]");
        await expect(page).toHaveURL(/\/homes\?q=Royston$/);
        await expect(page.getByText("Saved to your homes")).toBeVisible();
        const heart = list(page)
          .locator("article", { has: page.locator(`a[href="${href}"]`) })
          .getByRole("button", { name: "Remove from saved homes" });
        await expect(heart).toHaveAttribute("aria-pressed", "true");
        await expect(heart).toBeInViewport();
        const saved = await withDb((db) =>
          db.query(
            `select 1 from saved_listings s join listings l on l.id = s.listing_id
               join users u on u.id = s.user_id where l.slug = $1 and u.email = 'buyer@example.com'`,
            [slug],
          ),
        );
        expect(saved.rowCount, "saved in the database").toBe(1);
        // Back skips the sign-in page.
        await page.goBack();
        await expect(page).not.toHaveURL(/sign-in/);
      } finally {
        await unsave();
      }
    });
  });

  test.describe("a ?save= link someone else made", () => {
    test("saves nothing for a signed-in buyer who never tapped the heart", async ({ page }) => {
      const { id, slug } = await withDb((db) =>
        db
          .query<{ id: string; slug: string }>(
            `select id, slug from listings where removed_at is null and not idx_hidden
                and status = 'active' and city = 'Royston' order by slug limit 1`,
          )
          .then((r) => r.rows[0]),
      );
      const saved = () =>
        withDb((db) =>
          db
            .query(
              `select 1 from saved_listings s join users u on u.id = s.user_id
                where s.listing_id = $1 and u.email = 'buyer@example.com'`,
              [id],
            )
            .then((r) => r.rowCount),
        );
      const unsave = () =>
        withDb((db) =>
          db.query(
            `delete from saved_listings where listing_id = $1
               and user_id = (select id from users where email = 'buyer@example.com')`,
            [id],
          ),
        );
      await unsave();
      try {
        await signIn(page, "buyer@example.com", "/");
        await gotoHydrated(page, `/homes/${slug}?save=${id}`, "main p.tabular");
        // The address is cleaned up, and nothing was saved.
        await expect(page).toHaveURL(new RegExp(`/homes/${slug}$`));
        await page.waitForTimeout(1_500);
        await expect(page.getByText("Saved to your homes")).toHaveCount(0);
        expect(await saved()).toBe(0);
      } finally {
        await unsave();
      }
    });
  });

  test.describe("the dashboard", () => {
    test.describe.configure({ timeout: 90_000 });

    test("'All leads' returns to the tab the lead was opened from", async ({ page }) => {
      await signIn(page, "admin@adamsrealty.example", "/dashboard");
      await gotoHydrated(page, "/dashboard/leads?status=all", "main h1");
      const lead = page
        .locator("main a[href^='/dashboard/leads/']:visible")
        .filter({ hasNotText: "Export" })
        .first();
      const leadHref = (await lead.getAttribute("href"))!;
      await lead.click();
      await expect(page).toHaveURL(new RegExp(`${leadHref}$`));
      const all = page.getByRole("link", { name: "All leads" });
      await expect(all).toHaveAttribute("data-return-mode", "back");
      await all.click();
      await expect(page).toHaveURL(/\/dashboard\/leads\?status=all$/);

      // Opened directly, it goes to the last leads list seen in this tab.
      await gotoHydrated(page, leadHref, "main h1");
      await expect(all).toHaveAttribute("data-return-mode", "last");
      await expect(all).toHaveAttribute("href", "/dashboard/leads?status=all");
    });

    test("the listing editor has 'Back to listings'", async ({ page }) => {
      await signIn(page, "admin@adamsrealty.example", "/dashboard");
      await gotoHydrated(page, "/dashboard/listings?status=active", "main h1");
      const edit = page
        .locator("main a[href^='/dashboard/listings/']:visible")
        .filter({ hasNotText: "New listing" })
        .first();
      await edit.click();
      await expect(page).toHaveURL(/\/dashboard\/listings\/[0-9a-f-]{36}$/);
      const back = page.getByRole("link", { name: "Back to listings" });
      await expect(back).toHaveAttribute("data-return-mode", "back");
      await back.click();
      await expect(page).toHaveURL(/\/dashboard\/listings\?status=active$/);

      await gotoHydrated(page, "/dashboard/listings/new", "main h1");
      await expect(page.getByRole("link", { name: "Back to listings" })).toHaveAttribute(
        "href",
        "/dashboard/listings?status=active",
      );
    });
  });
}
