/**
 * Photo weight on phones (site review #10): what a buyer on a weak signal downloads before
 * scrolling, and how long the first photo takes. Drives Chromium as a Pixel 7 with Chrome
 * DevTools' "Slow 3G" profile (2,000 ms latency, 50 kB/s each way) and counts every byte
 * the browser receives (CDP `encodedDataLength`). Dev-only.
 *
 *   node e2e/fixtures/photo-host.mjs &                       # the fake MLS photo host
 *   npx tsx scripts/perf/photo-weight.ts                     # against http://localhost:3000
 *   npx tsx scripts/perf/photo-weight.ts --base http://localhost:3100 --label after
 *
 * Measure a production build (`next build`, then `next start -p 3100` with
 * E2E_PHOTO_HOST=http://127.0.0.1:4010 so the optimizer may fetch the fake host): the
 * dev server's JavaScript is several times bigger than production's.
 *
 * Scenarios:
 *  1. /homes with the seed's photos, Slow 3G: bytes before scrolling, first card photo.
 *  2. /homes with page 1's photos moved to the fake MLS host (unthrottled): image bytes.
 *  3. A home's page with its photos on the fake MLS host, Slow 3G: first photo, bytes.
 *  4. The same home with the seed's photos, Slow 3G: first photo, bytes.
 * The photos it moves are put back afterwards. Results land in scripts/perf/out/ (git-ignored).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  moveToPhotoHost as moveOut,
  restorePhotos,
  type MovedPhotos,
} from "../../e2e/fixtures/photo-db";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BASE = flag("--base") ?? "http://localhost:3000";
const LABEL = flag("--label") ?? "latest";
const PHOTO_HOST = flag("--photo-host") ?? "http://127.0.0.1:4010";
const CAP_MS = Number(flag("--cap") ?? 240_000);
const QUIET_MS = 4_000;

const SLOW_3G = { offline: false, latency: 2_000, downloadThroughput: 50_000, uploadThroughput: 50_000 };

type Tally = {
  total: number;
  images: number;
  imageCount: number;
  toPhotoHost: number;
  byType: Record<string, number>;
  /** The widest photo asked for, in real pixels (a full-size original counts as 3,000). */
  widest: number;
  elapsedMs: number;
  settled: boolean;
};

/** The pixel width an image request asks for: `w` for resized photos, 3000 for an original. */
function requestedWidth(url: string): number {
  if (url.startsWith(PHOTO_HOST)) return 3000;
  try {
    const w = Number(new URL(url).searchParams.get("w"));
    return Number.isFinite(w) ? w : 0;
  } catch {
    return 0;
  }
}

async function openPage(throttle: boolean) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (throttle) await cdp.send("Network.emulateNetworkConditions", SLOW_3G);

  const reqs = new Map<string, { url: string; type: string }>();
  const pending = new Set<string>();
  let lastActivity = Date.now();
  const tally: Tally = {
    total: 0,
    images: 0,
    imageCount: 0,
    toPhotoHost: 0,
    byType: {},
    widest: 0,
    elapsedMs: 0,
    settled: false,
  };
  cdp.on("Network.requestWillBeSent", (e) => {
    reqs.set(e.requestId, { url: e.request.url, type: e.type ?? "Other" });
    pending.add(e.requestId);
    lastActivity = Date.now();
    if (e.request.url.startsWith(PHOTO_HOST)) tally.toPhotoHost++;
    if (e.type === "Image") tally.widest = Math.max(tally.widest, requestedWidth(e.request.url));
  });
  cdp.on("Network.loadingFinished", (e) => {
    pending.delete(e.requestId);
    lastActivity = Date.now();
    const r = reqs.get(e.requestId);
    const type = r?.type ?? "Other";
    tally.total += e.encodedDataLength;
    tally.byType[type] = (tally.byType[type] ?? 0) + e.encodedDataLength;
    if (type === "Image") {
      tally.images += e.encodedDataLength;
      tally.imageCount++;
    }
  });
  cdp.on("Network.loadingFailed", (e) => {
    pending.delete(e.requestId);
    lastActivity = Date.now();
  });
  cdp.on("Network.dataReceived", () => {
    lastActivity = Date.now();
  });

  const started = Date.now();
  /** Waits until nothing has loaded for QUIET_MS (the page settled), or CAP_MS passed. */
  const settle = async () => {
    while (Date.now() - started < CAP_MS) {
      // Quiet: no request, no byte and no finish for QUIET_MS. Some requests never report
      // an end over CDP (cancelled prefetches), so a quiet network also counts after 3×.
      const quiet = Date.now() - lastActivity;
      if ((pending.size === 0 && quiet > QUIET_MS) || quiet > 3 * QUIET_MS) {
        tally.settled = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    tally.elapsedMs = lastActivity - started;
    return tally;
  };
  return { browser, page, settle };
}

/** ms from navigation start until `selector`'s image has loaded (its resource's responseEnd). */
async function photoTime(page: Page, selector: string): Promise<number | null> {
  try {
    await page.waitForFunction(
      (sel) => {
        const img = document.querySelector<HTMLImageElement>(sel);
        return !!img && img.complete && img.naturalWidth > 0;
      },
      selector,
      { timeout: CAP_MS, polling: 100 },
    );
  } catch {
    return null;
  }
  return page.evaluate((sel) => {
    const img = document.querySelector<HTMLImageElement>(sel)!;
    const entry = performance.getEntriesByName(img.currentSrc)[0] as
      | PerformanceResourceTiming
      | undefined;
    return Math.round(entry?.responseEnd ?? performance.now());
  }, selector);
}

/** ms from navigation start until `selector` is hydrated (React props attached). */
async function hydratedTime(page: Page, selector: string): Promise<number | null> {
  try {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
      },
      selector,
      { timeout: CAP_MS, polling: 100 },
    );
  } catch {
    return null;
  }
  return page.evaluate(() => Math.round(performance.now()));
}

const CARD_PHOTO = "[data-results-list] article img";
const HERO_PHOTO = "button[aria-label^='Open photo 1 '] img";

async function measureHomes(throttle: boolean) {
  const { browser, page, settle } = await openPage(throttle);
  await page.goto(`${BASE}/homes`, { waitUntil: "commit", timeout: CAP_MS });
  const firstPhotoMs = await photoTime(page, CARD_PHOTO);
  const tally = await settle();
  await browser.close();
  return { firstPhotoMs, ...tally };
}

async function measureListing(slug: string) {
  const { browser, page, settle } = await openPage(true);
  await page.goto(`${BASE}/homes/${slug}`, { waitUntil: "commit", timeout: CAP_MS });
  const [firstPhotoMs, saveReadyMs] = await Promise.all([
    photoTime(page, HERO_PHOTO),
    hydratedTime(page, "main button[aria-pressed]"),
  ]);
  const heroWidth = await page
    .$eval(HERO_PHOTO, (i) => (i as HTMLImageElement).currentSrc)
    .then(requestedWidth)
    .catch(() => null);
  const tally = await settle();
  await browser.close();
  return { firstPhotoMs, saveReadyMs, heroWidth, ...tally };
}

async function withDb<T>(fn: (db: Client) => Promise<T>) {
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://adams:adams@localhost:5432/adams_realty",
  });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

const moveToPhotoHost = (ids: string[]) => withDb((db) => moveOut(db, ids, PHOTO_HOST));
const restore = (moved: MovedPhotos) => withDb((db) => restorePhotos(db, moved));

async function pageOneIds(): Promise<string[]> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/homes`);
  const slugs = await page.$$eval("[data-results-list] article a[href^='/homes/']", (as) =>
    [...new Set(as.map((a) => a.getAttribute("href")!.slice("/homes/".length)))],
  );
  await browser.close();
  return withDb((db) =>
    db
      .query<{ id: string }>(`select id from listings where slug = any($1)`, [slugs])
      .then((r) => r.rows.map((x) => x.id)),
  );
}

async function sampleListing() {
  return withDb((db) =>
    db
      .query<{ id: string; slug: string }>(
        `select l.id, l.slug from listings l
          where l.status = 'active' and l.removed_at is null and not l.idx_hidden
            and l.transaction_type = 'sale' and l.property_type = 'single_family'
            and l.latitude is not null and not l.hide_address
            and (select count(*) from listing_media m where m.listing_id = l.id and m.kind = 'photo') >= 5
          order by l.list_date desc, l.id limit 1`,
      )
      .then((r) => r.rows[0]),
  );
}

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString("en-US")} KB`;

async function main() {
  const ping = await fetch(`${PHOTO_HOST}/`).catch(() => null);
  if (!ping?.ok) throw new Error(`Start the fake photo host first: node e2e/fixtures/photo-host.mjs`);

  const results: Record<string, unknown> = { base: BASE, label: LABEL, at: new Date().toISOString() };
  const out = path.resolve("scripts/perf/out/photo-weight");
  fs.mkdirSync(out, { recursive: true });
  // Saved after every scenario, so a long run can be read while it goes.
  const save = () =>
    fs.writeFileSync(path.join(out, `${LABEL}.json`), JSON.stringify(results, null, 2));

  console.log("1. /homes, seed photos, Slow 3G…");
  results.homesSlow3g = await measureHomes(true);
  save();

  console.log("2. /homes, page 1 on the fake MLS host…");
  const ids = await pageOneIds();
  let saved = await moveToPhotoHost(ids);
  try {
    results.homesMls = await measureHomes(false);
  } finally {
    await restore(saved);
  }
  save();

  const listing = await sampleListing();
  results.listing = listing.slug;
  console.log(`3. /homes/${listing.slug}, fake MLS photos, Slow 3G…`);
  saved = await moveToPhotoHost([listing.id]);
  try {
    results.listingMlsSlow3g = await measureListing(listing.slug);
  } finally {
    await restore(saved);
  }
  save();
  console.log(`4. /homes/${listing.slug}, seed photos, Slow 3G…`);
  results.listingSlow3g = await measureListing(listing.slug);
  save();

  const h = results.homesSlow3g as Awaited<ReturnType<typeof measureHomes>>;
  const m = results.homesMls as Awaited<ReturnType<typeof measureHomes>>;
  const lm = results.listingMlsSlow3g as Awaited<ReturnType<typeof measureListing>>;
  const ls = results.listingSlow3g as Awaited<ReturnType<typeof measureListing>>;
  console.log(`\n${LABEL} @ ${BASE}`);
  console.log(
    `/homes Slow 3G: ${kb(h.total)} total, ${kb(h.images)} in ${h.imageCount} images, first photo ${h.firstPhotoMs} ms, widest ${h.widest}px${h.settled ? "" : " (cap hit)"}`,
  );
  console.log(
    `/homes MLS photos: ${kb(m.images)} in ${m.imageCount} images, ${m.toPhotoHost} straight to the MLS host, widest ${m.widest}px`,
  );
  console.log(
    `home, MLS photos, Slow 3G: first photo ${lm.firstPhotoMs} ms (${lm.heroWidth}px), Save ready ${lm.saveReadyMs} ms, ${kb(lm.total)} total, ${kb(lm.images)} images${lm.settled ? "" : " (cap hit)"}`,
  );
  console.log(
    `home, seed photos, Slow 3G: first photo ${ls.firstPhotoMs} ms (${ls.heroWidth}px), Save ready ${ls.saveReadyMs} ms, ${kb(ls.total)} total, ${kb(ls.images)} images${ls.settled ? "" : " (cap hit)"}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
