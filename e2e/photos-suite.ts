import { type Page, expect, type test as baseTest } from "@playwright/test";
import { FIXTURE_PHOTO_HOST, PHONE_MAX_WIDTH, PHOTO_WIDTHS } from "../src/config/images";
import {
  fixtureMediaId,
  moveToPhotoHost,
  restorePhotos,
  type MovedPhotos,
} from "./fixtures/photo-db";
import { gotoHydrated, touchDrag, withDb } from "./mobile/helpers";

/*
 * Photos on a weak signal (site review #10): cards load only their first photo and the next
 * one on a swipe, phones never get a photo wider than PHONE_MAX_WIDTH, MLS photos are
 * resized by the site's image optimizer (the browser never fetches an original), and a
 * home's gallery, similar homes and location map load only when needed.
 *
 * The MLS photos are real 3000×2000, 2.5 MB JPEGs from a fake MLS host
 * (e2e/fixtures/photo-host.mjs on 127.0.0.1:4010, started by playwright.config.ts); each
 * test moves some listings' photos there and puts them back. Bytes are what the browser
 * received (CDP encodedDataLength), with the cache off.
 *
 * e2e/photos.spec.ts runs it on desktop and e2e/mobile/photos.spec.ts on pixel7 and
 * iphone13. Not a spec file.
 */

/**
 * Byte budgets for images loaded before the buyer scrolls, with every photo on the page
 * coming from the fake MLS host. Measured when set: /homes 109 KB on phones (the first
 * four or five cards' first photos at up to 800 px, 20–25 KB each for this test photo; a
 * real photo is about 70 KB) and 38 KB on desktop; a home's page 40 KB on phones (one
 * photo) and 133 KB on desktop (the five-photo mosaic). Before this change a phone fetched
 * every card's five 2.5 MB originals: 12 MB for the first card alone.
 */
const BUDGET = {
  phone: { homes: 180_000, listing: 100_000 },
  desktop: { homes: 120_000, listing: 300_000 },
};

type Shot = { url: string; bytes: number; done: boolean };

/** Every image request the page makes (CDP, so bytes are what really arrived). */
async function watchImages(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const shots = new Map<string, Shot>();
  /** Requests the browser sent straight to the MLS host (it never should). */
  const direct: string[] = [];
  cdp.on("Network.requestWillBeSent", (e) => {
    if (e.request.url.startsWith(FIXTURE_PHOTO_HOST)) direct.push(e.request.url);
    if (e.type === "Image") shots.set(e.requestId, { url: e.request.url, bytes: 0, done: false });
  });
  cdp.on("Network.loadingFinished", (e) => {
    const s = shots.get(e.requestId);
    if (s) Object.assign(s, { bytes: e.encodedDataLength, done: true });
  });
  cdp.on("Network.loadingFailed", (e) => {
    const s = shots.get(e.requestId);
    if (s) s.done = true;
  });
  const all = () => [...shots.values()];
  return {
    all,
    direct,
    bytes: () => all().reduce((n, s) => n + s.bytes, 0),
    /** Waits until the page stops asking for images and every one has arrived. */
    async settle() {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(750);
      await expect
        .poll(() => all().every((s) => s.done), { timeout: 30_000, message: "images still loading" })
        .toBe(true);
    },
  };
}

/** The moved photo an image request is for, if any. */
function photoFor(moved: MovedPhotos, url: string) {
  const id = fixtureMediaId(url);
  return id ? moved.photos.find((p) => p.id === id) : undefined;
}

/** The width an optimizer request asks for. */
const askedWidth = (url: string) => Number(new URL(url).searchParams.get("w"));

const loaded = (img: ReturnType<Page["locator"]>) =>
  img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);

/**
 * The real pixel width of the photo an <img> shows. (`naturalWidth` is divided by the
 * srcset density, so it says nothing about the file.) Decoding it again re-downloads it
 * with the cache off: call it after the byte checks.
 */
const pixelWidth = (img: ReturnType<Page["locator"]>) =>
  img.evaluate(async (i: HTMLImageElement) => {
    const copy = new Image();
    copy.src = i.currentSrc;
    await copy.decode();
    return copy.naturalWidth;
  });

async function listingIds(slugs: string[]): Promise<string[]> {
  return withDb((db) =>
    db
      .query<{ id: string }>(`select id from listings where slug = any($1)`, [slugs])
      .then((r) => r.rows.map((x) => x.id)),
  );
}

async function cardSlugs(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator("[data-results-list] article > a[href^='/homes/']")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  return hrefs.map((h) => h.slice("/homes/".length));
}

/** A home for sale with a full gallery, a map and similar homes. */
async function sampleHome() {
  return withDb((db) =>
    db
      .query<{ id: string; slug: string }>(
        `select l.id, l.slug from listings l
          where l.status = 'active' and l.removed_at is null and not l.idx_hidden
            and l.transaction_type = 'sale' and l.property_type = 'single_family'
            and l.latitude is not null and not l.hide_address and l.is_company_listing
            and (select count(*) from listing_media m
                  where m.listing_id = l.id and m.kind = 'photo') >= 6
          order by l.list_date desc, l.id limit 1`,
      )
      .then((r) => r.rows[0]),
  );
}

export function photosSuite(test: typeof baseTest, { phone }: { phone: boolean }) {
  const maxWidth = phone ? PHONE_MAX_WIDTH : PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];
  const budget = phone ? BUDGET.phone : BUDGET.desktop;

  test.describe("photos on a weak signal (site review #10)", () => {
    let moved: MovedPhotos | null = null;
    test.afterEach(async () => {
      if (moved) await withDb((db) => restorePhotos(db, moved!));
      moved = null;
    });

    test("/homes loads one resized photo per card, within the byte budget; a swipe loads the next", async ({
      page,
    }) => {
      await gotoHydrated(page, "/homes", "[aria-live=polite]");
      const ids = await listingIds(await cardSlugs(page));
      expect(ids.length).toBeGreaterThanOrEqual(12);
      moved = await withDb((db) => moveToPhotoHost(db, ids));
      // Most cards have several photos, so loading them all would show.
      expect(moved.photos.filter((p) => p.rank === 2).length).toBeGreaterThanOrEqual(10);

      const images = await watchImages(page);
      await gotoHydrated(page, "/homes", "[aria-live=polite]");
      await images.settle();

      const cardShots = images.all().filter((s) => photoFor(moved!, s.url));
      expect(cardShots.length, "some card photos loaded").toBeGreaterThan(0);
      expect(images.direct, "requests straight to the MLS host").toEqual([]);
      for (const s of cardShots) {
        expect(new URL(s.url).pathname, s.url).toBe("/_next/image");
        expect(askedWidth(s.url), s.url).toBeLessThanOrEqual(maxWidth);
        expect(photoFor(moved, s.url)!.rank, "only first photos before a swipe").toBe(1);
      }
      // One request per card at most (a picture source and its img never both load).
      const perListing = new Set(cardShots.map((s) => photoFor(moved!, s.url)!.listingId));
      expect(perListing.size).toBe(cardShots.length);
      test.info().annotations.push({ type: "image bytes", description: String(images.bytes()) });
      expect(images.bytes(), "image bytes before scrolling").toBeLessThanOrEqual(budget.homes);

      // The shown photos are real, resized ones.
      const first = page.locator("[data-results-list] article").first();
      const img = first.locator("img").first();
      await expect.poll(() => loaded(img)).toBe(true);
      expect(new URL(await img.evaluate((i: HTMLImageElement) => i.currentSrc)).pathname).toBe(
        "/_next/image",
      );
      expect(await pixelWidth(img)).toBeLessThanOrEqual(maxWidth);

      // A swipe (phones) or the arrow (desktop) loads the card's second photo, and only it.
      const slug = (await first.locator("> a").getAttribute("href"))!.slice("/homes/".length);
      const [firstId] = await listingIds([slug]);
      const second = moved.photos.find((p) => p.listingId === firstId && p.rank === 2)!;
      const asked = (p: { id: string }) =>
        images.all().some((s) => fixtureMediaId(s.url) === p.id);
      expect(asked(second)).toBe(false);
      if (phone) {
        await touchDrag(page, first.locator("[data-card-photos]"), { dx: -160, dy: 0 });
      } else {
        await first.hover();
        await first.locator("[data-carousel-arrow=right]").click();
      }
      await expect.poll(() => asked(second), { message: "the second photo loads" }).toBe(true);
      // Showing the second photo readies the third; the fourth waits for the next swipe.
      await page.waitForTimeout(1_000);
      const fourth = moved.photos.find((p) => p.listingId === firstId && p.rank === 4);
      if (fourth) expect(asked(fourth), "the fourth photo before a second swipe").toBe(false);
      expect(await first.locator("[data-card-photos] img").count()).toBeLessThanOrEqual(3);

      // A card far down the list gets its photo only when the buyer scrolls near it.
      const tenth = page.locator("[data-results-list] article").nth(9);
      const [tenthId] = await listingIds([
        (await tenth.locator("> a").getAttribute("href"))!.slice("/homes/".length),
      ]);
      const tenthPhoto = moved.photos.find((p) => p.listingId === tenthId && p.rank === 1)!;
      expect(asked(tenthPhoto), "the 10th card's photo before scrolling").toBe(false);
      await tenth.scrollIntoViewIfNeeded();
      await expect.poll(() => asked(tenthPhoto), { message: "it loads on scroll" }).toBe(true);
      await expect.poll(() => loaded(tenth.locator("img").first())).toBe(true);
      expect(images.direct).toEqual([]);
    });

    test("a home's page: resized MLS photos, and the gallery, similar homes and map wait until needed", async ({
      page,
    }) => {
      const home = await sampleHome();
      expect(home, "a company home for sale with 6+ photos").toBeTruthy();
      moved = await withDb((db) => moveToPhotoHost(db, [home.id]));

      const images = await watchImages(page);
      const styles: string[] = [];
      page.on("request", (r) => {
        if (/\/styles\/|maplibre/.test(r.url())) styles.push(r.url());
      });
      await gotoHydrated(page, `/homes/${home.slug}`, "main p.tabular");
      const hero = page.locator("button[aria-label^='Open photo 1 '] img");
      await expect.poll(() => loaded(hero), { timeout: 30_000 }).toBe(true);
      await images.settle();

      expect(images.direct, "requests straight to the MLS host").toEqual([]);
      const heroSrc = await hero.evaluate((i: HTMLImageElement) => i.currentSrc);
      expect(new URL(heroSrc).pathname).toBe("/_next/image");
      expect(askedWidth(heroSrc)).toBeLessThanOrEqual(maxWidth);
      const gallery = images.all().filter((s) => photoFor(moved!, s.url));
      const ranks = gallery.map((s) => photoFor(moved!, s.url)!.rank).sort();
      // Phones show one photo; desktops the mosaic of five. The rest wait for the viewer.
      expect(ranks).toEqual(phone ? [1] : [1, 2, 3, 4, 5]);
      for (const s of gallery) expect(askedWidth(s.url), s.url).toBeLessThanOrEqual(maxWidth);
      test.info().annotations.push({ type: "image bytes", description: String(images.bytes()) });
      expect(images.bytes(), "image bytes before scrolling").toBeLessThanOrEqual(budget.listing);
      expect(await pixelWidth(hero), "the hero's real width").toBeLessThanOrEqual(maxWidth);

      // Similar homes: no photo requested until the buyer scrolls near them.
      const similar = page.getByTestId("similar-homes");
      await expect(similar.locator("article").first()).toBeAttached();
      // Their photos (sample CDN ones), straight from the database.
      const similarSlugs = await similar
        .locator("article > a[href^='/homes/']")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href")!.slice("/homes/".length)));
      expect(similarSlugs.length).toBeGreaterThan(0);
      const similarPhotos = await withDb((db) =>
        db
          .query<{ url: string }>(
            `select m.url from listing_media m join listings l on l.id = m.listing_id
              where l.slug = any($1) and m.kind = 'photo'`,
            [similarSlugs],
          )
          .then((r) => r.rows.map((x) => new URL(x.url).pathname)),
      );
      expect(similarPhotos.length).toBeGreaterThan(0);
      const similarAsked = () =>
        images.all().filter((s) => similarPhotos.some((p) => s.url.includes(p))).length;
      await expect(similar.locator("img"), "no similar photo in the page yet").toHaveCount(0);
      expect(similarAsked(), "similar homes' photos before scrolling").toBe(0);

      // The map: nothing map-related until its section is near.
      const map = page.locator("[data-location-map]");
      await expect(map).toHaveAttribute("data-location-map", "waiting");
      expect(styles, "map requests before scrolling").toEqual([]);
      await page.getByRole("heading", { name: "Location" }).scrollIntoViewIfNeeded();
      await expect(map).toHaveAttribute("data-location-map", "loaded");
      await expect(map.locator(".maplibregl-canvas")).toHaveCount(1, { timeout: 20_000 });
      expect(styles.length).toBeGreaterThan(0);

      await similar.scrollIntoViewIfNeeded();
      await expect.poll(similarAsked, { message: "similar photos load on scroll" }).toBeGreaterThan(0);

      // The viewer loads the photo it shows, resized, and nothing straight from the MLS host.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole("button", { name: /photos?$/ }).first().click();
      const dialog = page.locator("dialog[open]");
      await page.keyboard.press("ArrowRight");
      await expect(dialog).toContainText("2 /");
      const shown = dialog.locator("img").first();
      await expect.poll(() => loaded(shown), { timeout: 20_000 }).toBe(true);
      expect(new URL(await shown.evaluate((i: HTMLImageElement) => i.currentSrc)).pathname).toBe(
        "/_next/image",
      );
      expect(await pixelWidth(shown)).toBeLessThanOrEqual(maxWidth);
      expect(images.direct).toEqual([]);
    });
  });
}
