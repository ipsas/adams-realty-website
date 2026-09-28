import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/** Listing URLs live in fixed chunks, /homes/sitemap/0.xml … 11.xml (src/lib/listings/sitemap-chunks.ts). */

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const path = (url: string) => new URL(url).pathname;

async function listingSitemapPaths(request: APIRequestContext) {
  const robots = await (await request.get("/robots.txt")).text();
  const chunks = [...robots.matchAll(/^Sitemap: (\S+\/homes\/sitemap\/\d+\.xml)$/gm)].map((m) =>
    path(m[1]),
  );
  expect(chunks).toEqual(Array.from({ length: 12 }, (_, id) => `/homes/sitemap/${id}.xml`));
  const perChunk: string[][] = [];
  for (const chunk of chunks) {
    const res = await request.get(chunk);
    expect(res.status()).toBe(200);
    perChunk.push(locs(await res.text()).map(path));
  }
  return perChunk;
}

async function firstCardPath(page: Page, search: string) {
  await page.goto(search);
  const href = await page.locator("article a[href^='/homes/']").first().getAttribute("href");
  expect(href).toMatch(/^\/homes\/[a-z0-9-]+$/);
  return href!;
}

test("robots.txt lists every listing sitemap chunk, and together they hold each live listing once", async ({
  page,
  request,
}) => {
  const perChunk = await listingSitemapPaths(request);
  const all = perChunk.flat();
  // The demo feed fits in the first chunk; the rest exist, empty, for a statewide feed.
  expect(perChunk[0].length).toBeGreaterThan(100);
  expect(perChunk.slice(1).every((c) => c.length === 0)).toBe(true);
  expect(new Set(all).size).toBe(all.length);
  for (const p of all) expect(p).toMatch(/^\/homes\/[a-z0-9-]+$/);

  expect(all).toContain(await firstCardPath(page, "/homes?ourListings=1"));
  expect(all).toContain(await firstCardPath(page, "/homes?mode=rent"));
  // Sold homes aren't listed.
  expect(all).not.toContain(await firstCardPath(page, "/homes?mode=sold"));

  // A sitemap URL opens its property page.
  const res = await request.get(all[0]);
  expect(res.status()).toBe(200);
});

test("the main sitemap keeps pages and agents, and no listing URLs", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const paths = locs(await res.text()).map(path);
  expect(paths).toContain("/homes");
  expect(paths.some((p) => /^\/agents\/[a-z0-9-]+$/.test(p))).toBe(true);
  expect(paths.filter((p) => /^\/homes\/.+/.test(p))).toEqual([]);
});
