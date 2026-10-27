import { expect, test, type Locator, type Page } from "@playwright/test";
import { site } from "../src/config/site";
import { signIn } from "./helpers";
import { withDb } from "./mobile/helpers";

/*
 * Georgia MLS IDX display rules (docs/plans/gamls-compliance.md), against the seed's
 * Georgia MLS fixtures (IDX_FIXTURES in scripts/seed-data.ts, all on Sycamore Place in
 * Decatur): one feed listing per hidden status, a sold one and an attributed active one;
 * and the firm's own hand-entered listings in the same statuses (FIRM_HIDDEN_FIXTURES, on
 * Quail Hollow Rd in Carnesville), which the firm hides the same way.
 */

const HIDDEN = [
  { mls: "10599001", status: "coming_soon" },
  { mls: "10599002", status: "withdrawn" },
  { mls: "10599003", status: "expired" },
  { mls: "10599004", status: "canceled" },
];
const FIRM_HIDDEN = [
  { mls: "10599101", status: "coming_soon", street: "101 Quail Hollow Rd", label: "Coming soon" },
  { mls: "10599102", status: "withdrawn", street: "102 Quail Hollow Rd", label: "Withdrawn" },
  { mls: "10599103", status: "expired", street: "103 Quail Hollow Rd", label: "Expired" },
  { mls: "10599104", status: "canceled", street: "104 Quail Hollow Rd", label: "Canceled" },
];
const SOLD = "10599005";
const ATTRIBUTED = "10599006";

async function slugOf(mls: string): Promise<{ id: string; slug: string }> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string; slug: string }>(
      "select id, slug from listings where mls_number = $1",
      [mls],
    );
    expect(rows, `seed fixture ${mls}`).toHaveLength(1);
    return rows[0];
  });
}

async function resultCount(page: Page): Promise<number> {
  const live = page.locator("[aria-live=polite]");
  await expect(live).toContainText(/\d+ results?|No homes/);
  const m = ((await live.textContent()) ?? "").match(/([\d,]+) results?/);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

const fontPx = (l: Locator) => l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

/** Median font size of the elements under `root` that hold text of their own. */
function medianTextPx(root: Locator) {
  return root.evaluate((el) => {
    const sizes: number[] = [];
    for (const node of el.querySelectorAll<HTMLElement>("*")) {
      const own = [...node.childNodes].some(
        (c) => c.nodeType === Node.TEXT_NODE && c.textContent!.trim().length > 1,
      );
      if (own && node.offsetParent !== null)
        sizes.push(parseFloat(getComputedStyle(node).fontSize));
    }
    sizes.sort((a, b) => a - b);
    return sizes[Math.floor(sizes.length / 2)];
  });
}

test.describe("listings Georgia MLS forbids showing", () => {
  for (const { mls, status, source } of [
    ...HIDDEN.map((h) => ({ ...h, source: "feed" })),
    ...FIRM_HIDDEN.map((h) => ({ ...h, source: "firm's own" })),
  ]) {
    test(`a ${status} ${source} listing has no page and isn't in search or the sitemap`, async ({
      page,
      request,
    }) => {
      const { slug } = await slugOf(mls);
      const res = await page.goto(`/homes/${slug}`);
      expect(res?.status()).toBe(404);
      await expect(page.getByText(`MLS #${mls}`)).toHaveCount(0);

      for (const q of [`q=${mls}&pending=1`, `q=${mls}&mode=sold`]) {
        await page.goto(`/homes?${q}`);
        expect(await resultCount(page), q).toBe(0);
      }
      const sitemap = await request.get("/homes/sitemap/0.xml");
      expect(sitemap.ok()).toBe(true);
      expect(await sitemap.text()).not.toContain(slug);
    });
  }

  test("the firm's own hidden listings stay in the dashboard, with their status", async ({
    page,
  }) => {
    await signIn(page, "agent@adamsrealty.example", "/dashboard");
    await page.goto("/dashboard/listings");
    for (const f of FIRM_HIDDEN) {
      const row = page.getByRole("row", { name: new RegExp(f.street) });
      await expect(row, f.status).toContainText(f.label);
      await expect(row.getByTestId("not-public"), f.status).toBeVisible();
      await expect(row.getByRole("link", { name: "Edit" }), f.status).toBeVisible();
    }
  });

  test("a saved home that went off market shows only that it's gone", async ({ page }) => {
    const { slug } = await slugOf("10599002");
    await signIn(page, "buyer@example.com", "/saved");
    const card = page.locator("article", { has: page.locator(`a[href='/homes/${slug}']`) });
    await expect(card).toContainText("No longer available");
    await expect(card).toContainText("302 Sycamore Place");
    await expect(card.locator("img:not([data-mls-credit] img)")).toHaveCount(0);
    await expect(card).not.toContainText("$401,002");
    await expect(card).not.toContainText(/\d bd/);
  });
});

test.describe("a sold Georgia MLS listing", () => {
  test("shows its primary photo only, on its page and its card", async ({ page }) => {
    const { slug } = await slugOf(SOLD);
    await page.goto(`/homes/${slug}`);
    await expect(page.getByRole("button", { name: /^Open photo 1 of 1$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open photo 2/ })).toHaveCount(0);
    await expect(page.getByText(/^\d+ photos?$/)).toHaveText("1 photo");
    const ld = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}",
    );
    expect(ld.image).toHaveLength(1);

    await page.goto(`/homes?mode=sold&q=${SOLD}`);
    const card = page.locator("article").first();
    await expect(card).toContainText("305 Sycamore Place");
    await expect(card.locator("img:not([data-mls-credit] img)")).toHaveCount(1);
    // One photo, not a swipeable set (whose later slides mount only on a swipe).
    await expect(card.locator("[data-card-photos]")).toHaveCount(0);
  });

  test("sold after it was listed, in its price and status history", async ({ page }) => {
    const { slug } = await slugOf(SOLD);
    await page.goto(`/homes/${slug}`);
    const history = page.locator("section", {
      has: page.getByRole("heading", { name: "Price & status history" }),
    });
    const rows = await history
      .locator("tbody tr")
      .evaluateAll((trs) =>
        trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent!.trim())),
      );
    const dateOf = (event: string) => {
      const row = rows.find((r) => r[1] === event);
      expect(row, event).toBeDefined();
      return Date.parse(row![0]);
    };
    const listed = dateOf("Listed for sale");
    const sold = dateOf("Sold");
    expect(sold).toBeGreaterThan(listed);
    // Newest first: the sale is the top row.
    expect(rows[0][1]).toBe("Sold");
  });
});

/**
 * The Georgia MLS mark reads in both themes: the official GAMLS IDX logo (`site.mls.logo`), one
 * PNG for both (on a white chip in dark), served (HTTP 200) and loaded, drawn at its own aspect
 * ratio. Checked under both the device setting and the site's own theme choice (`data-theme`
 * on <html>).
 */
async function expectMlsMark(page: Page, mark: Locator) {
  const logo = site.mls.logo;
  expect(logo, "site.mls.logo is set to the official Georgia MLS logo").not.toBeNull();
  if (!logo) return;
  const res = await page.request.get(logo.src);
  expect(res.status(), logo.src).toBe(200);
  expect(res.headers()["content-type"], logo.src).toContain("image/png");

  const expectShown = async (theme: "light" | "dark") => {
    await expect(mark).toHaveAttribute("data-mls-mark", "logo");
    await expect(mark.locator("img"), theme).toHaveCount(1);
    const shown = mark.locator(`img[src="${logo.src}"]`);
    await expect(shown, theme).toBeVisible();
    await expect(shown).toHaveAttribute("alt", site.mls.name);
    await expect
      .poll(() => shown.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    // Not stretched: the drawn box has the artwork's own ratio.
    const box = await shown.evaluate((img: HTMLImageElement) => {
      const r = img.getBoundingClientRect();
      return { w: r.width, h: r.height, ratio: img.naturalWidth / img.naturalHeight };
    });
    expect(box.h).toBeGreaterThanOrEqual(20);
    expect(Math.abs(box.w / box.h - box.ratio)).toBeLessThan(0.05);
  };

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expectShown(colorScheme);
  }
  // The site's theme choice overrides the device's.
  const setTheme = (t: string | null) =>
    page.evaluate((t) => {
      if (t) document.documentElement.setAttribute("data-theme", t);
      else document.documentElement.removeAttribute("data-theme");
    }, t);
  await page.emulateMedia({ colorScheme: "light" });
  await setTheme("dark");
  await expectShown("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await setTheme("light");
  await expectShown("light");
  await setTheme(null);
  await page.emulateMedia({ colorScheme: null });
}

test.describe("attribution and required fields", () => {
  test("the listing page names the firm prominently and shows Exhibit C's fields", async ({
    page,
  }) => {
    const { slug } = await slugOf(ATTRIBUTED);
    await page.goto(`/homes/${slug}`);

    const office = page.getByTestId("listing-office");
    await expect(office).toContainText("Listing by");
    expect(await fontPx(office)).toBeGreaterThanOrEqual(await medianTextPx(page.locator("main")));

    const info = page.getByTestId("listing-info");
    await expect(info).toContainText("Listing office:");
    await expect(info).toContainText(`Listing ID: ${ATTRIBUTED}`);
    await expect(info).toContainText("Status: For sale");
    await expect(info).toContainText("Contact phone: (404) 555-0166");
    await expect(info).toContainText("Contact email: listings@decatur-homes.example");
    // No buyer-broker compensation (Georgia MLS R&R Art. V), though the fixture stores it:
    // not on the page, nor anywhere in the HTML (RSC payload, JSON-LD).
    await expect(page.getByTestId("buyer-compensation")).toHaveCount(0);
    await expect(info).not.toContainText(/compensation/i);
    const html = await page.content();
    expect(html).not.toContain("2.5 %");
    expect(html).not.toContain("Paid at closing from the seller");
    expect(html).not.toMatch(/compensation/i);
    // Georgia MLS name/logo and copyright.
    await expectMlsMark(page, info.locator("[data-mls-mark]"));
    await expect(info).toContainText(
      `Listing information © ${new Date().getFullYear()} ${site.mls.copyrightHolder}. All rights reserved.`,
    );

    // Exhibit C's excluded fields appear nowhere.
    const text = (await page.locator("main").textContent()) ?? "";
    for (const label of [
      /listing agreement/i,
      /contract date/i,
      /on market date/i,
      /expiration/i,
      /private remarks/i,
      /showing (contact|requirements|instructions)/i,
      /office remarks/i,
    ]) {
      expect(text).not.toMatch(label);
    }
  });

  test("every card and map popup names the listing firm, as large as the listing text", async ({
    page,
  }) => {
    const year = new Date().getFullYear();
    await page.goto(`/homes?q=Decatur`);
    const cards = page.locator("article");
    await expect(cards.first()).toBeVisible();
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const office = card.getByTestId("card-office");
      await expect(office, `card ${i}`).toContainText("Listing by ");
      expect(await fontPx(office)).toBeGreaterThanOrEqual(await medianTextPx(card));
      // Georgia MLS's name (the logo's alt), logo and copyright on every feed card.
      const credit = card.locator("[data-mls-credit]");
      await expect(credit, `card ${i}`).toContainText(`© ${year} Georgia MLS`);
      const img = credit.locator("img");
      await expect(img).toHaveAttribute("alt", site.mls.name);
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
        .toBeGreaterThan(0);
    }

    // The pins are drawn on the map's canvas: click the first one where it is drawn.
    const canvas = page.locator(".maplibregl-canvas");
    test.skip(!(await canvas.isVisible()), "the map is hidden on this viewport");
    const point = await page
      .waitForFunction(() => {
        const m = (window as unknown as { __searchMap?: import("maplibre-gl").Map }).__searchMap;
        if (!m || m.isMoving() || !m.loaded()) return null;
        const [f] = m.queryRenderedFeatures({ layers: ["pins", "pin-dots"] });
        if (!f) return null;
        const p = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
        const r = m.getCanvas().getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      })
      .then((h) => h.jsonValue() as Promise<{ x: number; y: number }>);
    await page.mouse.click(point.x, point.y);
    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toContainText("Listing by");
    await expect(popup).toContainText(`© ${year} Georgia MLS`);
  });

  test("the Georgia MLS name, logo and copyright are on the search page, the footer and the corrections page", async ({
    page,
  }) => {
    const year = new Date().getFullYear();
    await page.goto("/homes");
    const onSearch = page.locator("[data-mls-attribution]");
    await expect(onSearch).toContainText(`© ${year} Georgia MLS`);
    await expectMlsMark(page, onSearch.locator("[data-mls-mark]"));

    await page.goto("/");
    const footer = page.locator("footer [data-mls-attribution]");
    await expect(footer).toContainText(`Listing information © ${year} Georgia MLS.`);
    await expectMlsMark(page, footer.locator("[data-mls-mark]"));

    await page.goto("/listing-corrections");
    const corrections = page.locator("main [data-mls-attribution]");
    await expectMlsMark(page, corrections.locator("[data-mls-mark]"));
  });
});

test.describe("reporting a listing problem", () => {
  test("goes from the listing page to the office", async ({ page }) => {
    const { id, slug } = await slugOf(ATTRIBUTED);
    await page.goto(`/homes/${slug}`);
    await page.getByRole("link", { name: "Report a listing problem" }).click();
    await expect(page).toHaveURL(`/listing-corrections?listing=${slug}`);
    await expect(page.getByTestId("reported-listing")).toContainText(`MLS #${ATTRIBUTED}`);
    await expect(page.locator(`main a[href="tel:+17062460053"]`)).toBeVisible();
    await expect(page.getByTestId("corrections-email")).toHaveAttribute(
      "href",
      new RegExp(`^mailto:contracts\\.adamsrealty@gmail\\.com\\?subject=.*${ATTRIBUTED}`),
    );
    await expect(page.getByText("within one business day").first()).toBeVisible();

    const email = `gamls-report-${Date.now()}@example.com`;
    await page.getByLabel(/name/i).first().fill("Georgia MLS Compliance");
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByRole("button", { name: /send|submit/i }).click();
    await expect(page.getByText(/your report went to the Adams Realty office/)).toBeVisible();

    const rows = await withDb(async (db) => {
      const r = await db.query(
        "select source, type, listing_id, agent_id, message from inquiries where email = $1",
        [email],
      );
      await db.query("delete from inquiries where email = $1", [email]);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "report",
      type: "question",
      listing_id: id,
      agent_id: null,
    });
    expect(rows[0].message).toContain(ATTRIBUTED);
  });
});

test.describe("traffic statistics", () => {
  test("a listing page view is counted, and admins can export it as CSV", async ({ page }) => {
    const { id, slug } = await slugOf(ATTRIBUTED);
    const views = () =>
      withDb(async (db) => {
        const { rows } = await db.query<{ n: number }>(
          "select coalesce(sum(views), 0)::int as n from listing_views where listing_id = $1",
          [id],
        );
        return rows[0].n;
      });
    const before = await views();
    await page.goto(`/homes/${slug}`);
    await expect.poll(views).toBe(before + 1);

    await signIn(page, "admin@adamsrealty.example", "/dashboard/traffic");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Listing traffic");
    await expect(page.locator("main table")).toContainText(ATTRIBUTED);
    const csv = await page.request.get("/dashboard/traffic/export?feed=1");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const body = await csv.text();
    expect(body).toContain("MLS number,Address,City,Listing office,Source,Page views,From,To");
    const row = body.split("\r\n").find((l) => l.startsWith(`${ATTRIBUTED},`));
    expect(row).toContain("306 Sycamore Place,Decatur");
    expect(row).toContain(`,Georgia MLS,${before + 1},`);
  });

  test("the export is staff-only: admins yes, agents and visitors no", async ({
    page,
    request,
  }) => {
    const anonymous = await request.get("/dashboard/traffic/export", { maxRedirects: 0 });
    expect(anonymous.status()).toBe(307);
    expect(anonymous.headers().location).toContain("/sign-in");
    await signIn(page, "agent@adamsrealty.example", "/dashboard");
    expect((await page.request.get("/dashboard/traffic/export")).status()).toBe(403);
    const res = await page.goto("/dashboard/traffic");
    expect(res?.status()).toBe(403);
  });
});

test.describe("anti-scraping", () => {
  const ip = () =>
    `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

  test("HTTP libraries are refused on listing routes, browsers aren't", async ({ request }) => {
    const bot = await request.get("/homes", {
      headers: { "user-agent": "python-requests/2.32.3" },
    });
    expect(bot.status()).toBe(403);
    const api = await request.get("/api/locations/suggest?q=Roy", {
      headers: { "user-agent": "curl/8.7.1" },
    });
    expect(api.status()).toBe(403);
    expect((await request.get("/homes")).status()).toBe(200);
    // Sitemaps stay open to crawlers of any kind.
    const sitemap = await request.get("/homes/sitemap/0.xml", {
      headers: { "user-agent": "curl/8.7.1" },
    });
    expect(sitemap.status()).toBe(200);
  });

  test("one client over the limit gets 429 with Retry-After; another client doesn't", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    // Limits count per clock minute: start early in one so the run can't straddle two.
    const intoMinute = Date.now() % 60_000;
    if (intoMinute > 30_000) await new Promise((r) => setTimeout(r, 60_500 - intoMinute));
    const scraper = ip();
    const statuses: number[] = [];
    for (let i = 0; i < 301; i++) {
      const res = await request.get(`/api/locations/suggest?q=Ro${i % 3 ? "y" : "s"}`, {
        headers: { "x-forwarded-for": scraper },
      });
      statuses.push(res.status());
      if (res.status() === 429) {
        expect(Number(res.headers()["retry-after"])).toBeGreaterThan(0);
        break;
      }
    }
    // 300 a minute are allowed, then refused.
    expect(statuses.slice(0, 300).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const other = await request.get("/api/locations/suggest?q=Roy", {
      headers: { "x-forwarded-for": ip() },
    });
    expect(other.status()).toBe(200);
  });
});
