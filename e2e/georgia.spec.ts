import { expect, test, type Page } from "@playwright/test";
import { areas } from "../src/config/areas";
import { site } from "../src/config/site";
import { waitLikeAPerson } from "./helpers";
import { withDb } from "./mobile/helpers";

/*
 * GA-A (docs/plans/dark-mode-and-georgia.md): listings cover all of Georgia, the firm's own
 * statements stay Northeast Georgia. Nothing here hard-codes a town list: the town chips,
 * footer and places index come from the listings, so the tests read them from the pages.
 */

async function resultCount(page: Page): Promise<number> {
  const live = page.locator("[aria-live=polite]");
  await expect(live).toContainText(/\d+ results?/);
  const text = (await live.textContent()) ?? "";
  return Number(text.match(/([\d,]+) results?/)![1].replace(/,/g, ""));
}

const num = (s: string | null) => Number((s ?? "").replace(/[^\d]/g, ""));

test.describe("listing coverage copy says Georgia", () => {
  test("search titles and headings", async ({ page }) => {
    await page.goto("/homes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Homes for sale in Georgia");
    await expect(page).toHaveTitle(/^Homes for sale in Georgia/);

    await page.goto("/homes?mode=rent");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rentals in Georgia");
    await expect(page).toHaveTitle(/^Homes for rent in Georgia/);

    await page.goto("/homes?mode=sold");
    await expect(page).toHaveTitle(/^Recently sold homes in Georgia/);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toBe(
      "Browse recently sold homes in Georgia from Georgia MLS, with the true cost of owning each home and no ads.",
    );
  });

  test("the home page hero covers all of Georgia and never mentions monthly costs", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("All of Georgia", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText(
      "Homes, land, farms and lake property across Georgia, updated directly from Georgia MLS.",
    );
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toMatch(/monthly cost/);
    const meta = await page.locator('meta[name="description"]').getAttribute("content");
    expect(meta).not.toMatch(/monthly cost/i);
  });

  test("the firm's own statements stay Northeast Georgia", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("main")).toContainText("Northeast Georgia");
    await page.goto("/");
    // The home page sells all of Georgia; its firm lines say where the agents are.
    const main = page.locator("main");
    await expect(main).toContainText(
      "Algorithms guess. One of our Northeast Georgia agents looks at your home or land",
    );
    await expect(main).not.toContainText("A local agent looks at your home");
    await expect(main.getByText("Our team in Northeast Georgia", { exact: true })).toBeVisible();
    const footer = page.locator("footer");
    await expect(footer).toContainText(
      "Homes, land, farms and lake property across Georgia, with agents serving Northeast Georgia from our office in Royston.",
    );
  });

  test("the no-ads and never-sell promises survive, word for word", async ({ page }) => {
    await page.goto("/");
    const main = page.locator("main");
    await expect(main).toContainText("We never sell your details.");
    await expect(main).toContainText("Zero ads.");
    await expect(page.locator("footer")).toContainText(
      "No ads, and we never sell your information.",
    );
  });
});

test.describe("towns come from the listings", () => {
  test("the home page shows more than 5 town chips, each finding homes", async ({ page }) => {
    await page.goto("/");
    const chips = page.locator("[data-top-cities] a[href^='/homes?q=']");
    const hrefs = await chips.evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThan(5);
    expect(hrefs.length).toBeLessThanOrEqual(12);
    // Statewide: the busiest places aren't only the firm's towns.
    expect(hrefs).toContain("/homes?q=Atlanta");
    for (const href of hrefs) {
      await page.goto(href);
      expect(await resultCount(page), href).toBeGreaterThanOrEqual(1);
    }
  });

  test("the town chips are the busiest towns, most homes for sale first", async ({ page }) => {
    // Every town's homes for sale (what /homes shows by default, commercial left out),
    // counted in the database.
    const busiest = await withDb((db) =>
      db
        .query<{ city: string; n: number }>(
          `select city, count(*)::int as n from listings
            where removed_at is null and not idx_hidden and transaction_type = 'sale'
              and status in ('active', 'coming_soon') and property_type <> 'commercial'
            group by city order by n desc, city`,
        )
        .then((r) => r.rows),
    );
    await page.goto("/");
    const chips = await page.locator("[data-top-cities] a[href^='/homes?q=']").allTextContents();
    expect(chips.length).toBeGreaterThan(5);
    const counts = chips.map((city) => busiest.find((b) => b.city === city)?.n ?? 0);
    // Busiest first: counts never go up along the chips...
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `${chips[i]} after ${chips[i - 1]}`).toBeLessThanOrEqual(counts[i - 1]);
    }
    // ...and no town left out has more homes than the last chip.
    const outside = busiest.filter((b) => !chips.includes(b.city));
    expect(Math.max(0, ...outside.map((b) => b.n))).toBeLessThanOrEqual(counts.at(-1)!);
    // The seed makes the ranking matter: A–Z would put a smaller town first.
    expect(chips[0]).toBe(busiest[0].city);
    expect(chips).not.toEqual([...chips].sort((a, b) => a.localeCompare(b)));
  });

  test("the footer lists the busiest towns, the same as the home page chips", async ({ page }) => {
    await page.goto("/");
    const chips = await page.locator("[data-top-cities] a[href^='/homes?q=']").allTextContents();
    const places = page.locator("footer [data-footer-column='Places']");
    await expect(places.getByRole("heading")).toHaveText("Places");
    const footerTowns = await places.locator("a[href^='/homes?q=']").allTextContents();
    expect(footerTowns).toEqual(chips.slice(0, footerTowns.length));
    expect(footerTowns.length).toBe(6);
    await expect(places.getByRole("link", { name: /All towns/ })).toHaveAttribute(
      "href",
      "/places",
    );
  });

  test("'See all towns' opens every town with homes for sale, by county", async ({ page }) => {
    await page.goto("/");
    const forSale = num(
      await page.locator("dl a", { hasText: "Homes for sale" }).locator("dd").textContent(),
    );
    await page
      .locator("[data-top-cities]")
      .getByRole("link", { name: /See all towns/ })
      .click();
    await expect(page).toHaveURL(/\/places$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Towns and cities across Georgia",
    );

    // Grouped by county, A–Z, the firm's counties marked.
    const counties = await page.locator("main section h2").allTextContents();
    expect(counties.length).toBeGreaterThan(20);
    const named = counties.filter((c) => c !== "County not listed");
    expect(named).toEqual([...named].sort((a, b) => a.localeCompare(b)));
    for (const c of ["Fulton County", "Chatham County", "Franklin County"]) {
      expect(counties).toContain(c);
    }
    const marked = await page
      .locator("main section", { hasText: "Our agents work here" })
      .locator("h2")
      .allTextContents();
    expect(marked.length).toBeGreaterThan(0);
    for (const c of marked) {
      expect(site.market.counties.map((n) => `${n} County`)).toContain(c);
    }

    // Every home for sale is counted once: the index adds up to the home page's number.
    const counts = await page.locator("main section li a span.tabular").allTextContents();
    expect(counts.map(num).reduce((a, b) => a + b, 0)).toBe(forSale);
    await expect(page.locator("header dl")).toContainText(String(forSale));

    // A town links to its search.
    await page
      .locator("section", { has: page.getByRole("heading", { name: "Chatham County" }) })
      .getByRole("link", { name: /^Savannah/ })
      .click();
    await expect(page).toHaveURL(/\/homes\?q=Savannah$/);
    expect(await resultCount(page)).toBeGreaterThanOrEqual(1);
  });
});

test("'Handpicked by our agents' shows only Adams listings and homes in the firm's area", async ({
  page,
}) => {
  await page.goto("/");
  const section = page.locator("[data-featured]");
  await expect(section.getByRole("heading", { name: "Handpicked by our agents" })).toBeVisible();
  const slugs = await section
    .locator("article a[href^='/homes/']")
    .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")!.slice(7)))]);
  expect(slugs.length).toBeGreaterThanOrEqual(4);

  const rows = await withDb((db) =>
    db
      .query<{ slug: string; company: boolean; county: string | null }>(
        "select slug, is_company_listing as company, county from listings where slug = any($1)",
        [slugs],
      )
      .then((r) => r.rows),
  );
  expect(rows.length).toBe(slugs.length);
  const firmCounties = new Set([...site.market.counties, ...areas.flatMap((a) => a.counties)]);
  for (const r of rows) {
    expect(r.company || (r.county !== null && firmCounties.has(r.county)), r.slug).toBe(true);
  }
  // …and each is a home our agents can show: its page offers a tour.
  for (const slug of slugs) {
    await page.goto(`/homes/${slug}`);
    await expect(page.getByRole("tab", { name: "Request a tour" }), slug).toBeVisible();
  }
});

test.describe("homes outside the firm's area take questions, not tours", () => {
  async function firstListing(page: Page, q: string) {
    await page.goto(`/homes?${new URLSearchParams({ q })}`);
    expect(await resultCount(page)).toBeGreaterThan(0);
    await page.locator("article a[href^='/homes/']").first().click();
    await expect(page).toHaveURL(/\/homes\/[a-z0-9-]+$/);
  }

  test("a Savannah listing offers 'Ask a question', and the office answers", async ({ page }) => {
    await firstListing(page, "Savannah");
    const contact = page.locator("#contact");
    await expect(contact.getByRole("heading", { name: "Ask a question" })).toBeVisible();
    await expect(contact).toContainText(
      "Adams Realty is based in Royston and works mainly in Northeast Georgia.",
    );
    await expect(page.getByRole("tab", { name: "Request a tour" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Toggle tour type" })).toHaveCount(0);
    await expect(page.getByText(/In person|See it with a local expert/)).toHaveCount(0);
    // The phone CTA (hidden on desktop) says the same.
    await expect(page.locator("a[href='#contact']")).toHaveText("Ask a question");

    // A throwaway address, removed at the end so test leads never crowd the dashboard.
    const email = `e2e-sam-${Date.now()}@example.com`;
    await contact.locator("#c-name").fill("Sam Tester");
    await contact.locator("#c-email").fill(email);
    await waitLikeAPerson(page);
    await contact.getByRole("button", { name: "Send message" }).click();
    await expect(contact).toContainText(
      "Thanks, Sam! Your question went to the Adams Realty office, and we'll get back to you soon.",
    );
    await expect(contact).not.toContainText(/tour/i);

    // Saved as a question for the office, with no agent and no tour time.
    const [lead] = await withDb((db) =>
      db
        .query<{ type: string; agent_id: string | null; tour_at: Date | null; status: string }>(
          "select type, agent_id, tour_at, status from inquiries where email = $1 order by created_at desc limit 1",
          [email],
        )
        .then((r) => r.rows),
    );
    await withDb((db) => db.query("delete from inquiries where email = $1", [email]));
    expect(lead).toEqual({ type: "question", agent_id: null, tour_at: null, status: "new" });
  });

  test("a Royston listing keeps tour requests", async ({ page }) => {
    await firstListing(page, "Royston");
    const contact = page.locator("#contact");
    await expect(page.getByRole("tab", { name: "Request a tour" })).toBeVisible();
    await expect(page.locator("[data-out-of-area]")).toHaveCount(0);
    await expect(contact).not.toContainText("works mainly in Northeast Georgia");
    await expect(page.locator("a[href='#contact']")).toHaveText("Request a tour");
  });
});

test.describe("payment estimates follow the county", () => {
  test("a Savannah home's insurance assumes the coastal rate; Royston's the inland one", async ({
    page,
  }) => {
    const costs = page.locator("#costs");
    await page.goto(`/homes?${new URLSearchParams({ q: "Savannah" })}`);
    await page.locator("article a[href^='/homes/']").first().click();
    await expect(costs).toContainText("insurance assumes 1.2% of price per year");

    await page.goto(`/homes?${new URLSearchParams({ q: "Royston" })}`);
    await page.locator("article a[href^='/homes/']").first().click();
    await expect(costs).toContainText("insurance assumes 0.6% of price per year");
  });
});

test.describe("the search map starts on the search", () => {
  type View = { west: number; south: number; east: number; north: number; zoom: number };
  const mapView = (page: Page) =>
    page
      .waitForFunction(() => {
        const map = (window as unknown as { __searchMap?: import("maplibre-gl").Map }).__searchMap;
        if (!map || map.isMoving()) return null;
        const b = map.getBounds();
        return {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
          zoom: map.getZoom(),
        } satisfies View;
      })
      .then((h) => h.jsonValue() as Promise<View>);

  test("with no homes to show, it shows all of Georgia", async ({ page }) => {
    await page.goto("/homes?q=Nowhereville");
    expect(await resultCount(page)).toBe(0);
    const v = await mapView(page);
    const ga = site.coverage.bounds;
    expect(v.west).toBeLessThanOrEqual(ga.west);
    expect(v.east).toBeGreaterThanOrEqual(ga.east);
    expect(v.south).toBeLessThanOrEqual(ga.south);
    expect(v.north).toBeGreaterThanOrEqual(ga.north);
    // Fitted, not zoomed out to the continent.
    expect(v.zoom).toBeGreaterThan(4.5);
  });

  test("with results, it fits them", async ({ page }) => {
    await page.goto("/homes?q=Savannah");
    const v = await mapView(page);
    expect(v.zoom).toBeGreaterThan(8);
    expect(v.west).toBeLessThan(-81.1);
    expect(v.east).toBeGreaterThan(-81.1);
    expect(v.south).toBeLessThan(32.05);
    expect(v.north).toBeGreaterThan(32.05);
  });
});
