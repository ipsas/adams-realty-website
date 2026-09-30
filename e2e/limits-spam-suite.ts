import { type Page, expect, type test as baseTest } from "@playwright/test";
import { site } from "../src/config/site";
import { PAGE_UNITS } from "../src/lib/anti-scraping";
import { signIn, waitLikeAPerson } from "./helpers";
import {
  expectNoHorizontalOverflow,
  expectNoSeriousAxe,
  expectTapTargets,
  gotoHydrated,
  withDb,
} from "./mobile/helpers";
import { DARK_CANVAS, LIGHT_CANVAS, canvas, dataTheme, storePref } from "./theme-suite";

/*
 * The listing rate limiter and form spam protection (site review #6, and spam on the
 * public forms). e2e/limits-spam.spec.ts runs it on desktop and
 * e2e/mobile/limits-spam.spec.ts on pixel7 and iphone13. Not a spec file itself.
 *
 * Each test acts from its own made-up client address (x-forwarded-for, which `next dev`
 * passes through as Vercel does) and puts that address over a limit by writing its
 * counter, so nothing depends on sending thousands of requests or on the clock.
 */

const LINKEDIN =
  "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BUSY = "One moment, please";
const LONG_PAUSE = "Listings are paused for now";

const testIp = () =>
  `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

/** Sets `name` (a daily window) for `subject` to `count` in the current UTC day. */
async function setDailyCounter(name: string, subject: string, count: number) {
  await withDb((db) =>
    db.query(
      `insert into rate_limits (key, window_start, count)
       values ($1, to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), $2)
       on conflict (key) do update set window_start = excluded.window_start, count = excluded.count`,
      [`${name}:${subject}`, count],
    ),
  );
}

/** The whole day's page allowance for `ip` is used up: a long pause. */
const pagesUsedUp = (ip: string) => setDailyCounter("page:1d", ip, 5_000 * PAGE_UNITS);

/**
 * This minute's page allowance for `ip` is used up: a short pause ("One moment, please").
 * Waits out the end of a minute first, so the window can't roll over mid-test.
 */
async function burstUsedUp(page: Page, ip: string) {
  const intoMinute = await withDb((db) =>
    db
      .query<{ s: number }>("select extract(second from now())::float as s")
      .then((r) => Number(r.rows[0].s)),
  );
  if (intoMinute > 30) await page.waitForTimeout((61 - intoMinute) * 1_000);
  await withDb((db) =>
    db.query(
      `insert into rate_limits (key, window_start, count)
       values ($1, to_timestamp(floor(extract(epoch from now()) / 60) * 60), $2)
       on conflict (key) do update set window_start = excluded.window_start, count = excluded.count`,
      [`page:1m:${ip}`, 120 * PAGE_UNITS],
    ),
  );
}

const counter = (key: string) =>
  withDb((db) =>
    db
      .query<{ count: number }>("select count from rate_limits where key = $1", [key])
      .then((r) => r.rows[0]?.count ?? 0),
  );

const clearCounters = (subject: string) =>
  withDb((db) => db.query("delete from rate_limits where key like $1", [`%:${subject}`]));

const latestLead = (email: string) =>
  withDb((db) =>
    db
      .query<{
        id: string;
        status: string;
        agent_id: string | null;
        metadata: Record<string, string>;
      }>(
        "select id, status, agent_id, metadata from inquiries where email = $1 order by created_at desc limit 1",
        [email],
      )
      .then((r) => r.rows[0]),
  );

const deleteLeads = (email: string) =>
  withDb((db) => db.query("delete from inquiries where email = $1", [email]));

async function firmListingPath(page: Page) {
  await page.goto("/homes?ourListings=1");
  const href = await page.locator("article a[href^='/homes/']").first().getAttribute("href");
  expect(href).toMatch(/^\/homes\/[a-z0-9-]+$/);
  return href!;
}

export function limitsSpamSuite(test: typeof baseTest, { phone }: { phone: boolean }) {
  test.describe("the listing rate limiter", () => {
    test("over the limit: a branded 'One moment, please' page with Back, Try again and the office phone", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const ip = testIp();
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await gotoHydrated(page, "/about", "main h1");
      await burstUsedUp(page, ip);

      const res = await page.goto("/homes?q=Royston");
      expect(res?.status()).toBe(429);
      expect(Number(res?.headers()["retry-after"])).toBeGreaterThan(0);
      expect(res?.headers()["x-robots-tag"]).toBe("noindex");
      await expect(page.getByRole("heading", { level: 1, name: BUSY })).toBeVisible();
      await expect(page).toHaveTitle(`${BUSY} | ${site.name}`);
      await expect(page.getByRole("link", { name: `${site.name} home` })).toHaveAttribute(
        "href",
        "/",
      );
      const call = page.getByTestId("busy-phone");
      await expect(call).toHaveText(site.phone);
      await expect(call).toHaveAttribute("href", `tel:+1${site.phone.replace(/\D/g, "")}`);
      await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
        "href",
        `/sign-in?next=${encodeURIComponent("/homes?q=Royston")}`,
      );
      if (phone) {
        await expectTapTargets(page, "[data-testid=busy-retry], [data-testid=busy-back]", 44);
        await expectNoHorizontalOverflow(page);
      }

      // Back returns to where they were.
      await page.getByTestId("busy-back").click();
      await expect(page).toHaveURL(/\/about$/);

      // Once the wait is over, Try again opens the search.
      expect((await page.goto("/homes?q=Royston"))?.status()).toBe(429);
      await clearCounters(ip);
      await page.getByTestId("busy-retry").click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Homes for sale in Royston");
      await clearCounters(ip);
    });

    test("a client-side refresh over the limit lands on the same page, not a broken screen", async ({
      page,
    }) => {
      const ip = testIp();
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      test.setTimeout(90_000);
      await gotoHydrated(page, "/homes?q=Carnesville&mode=rent", "[data-testid=no-results]");
      await burstUsedUp(page, ip);
      await page
        .getByTestId("no-results")
        .getByRole("link", { name: "See all rentals in Georgia" })
        .click();
      await expect(page.getByRole("heading", { level: 1, name: BUSY })).toBeVisible();
      await expect(page.getByTestId("busy-retry")).toHaveAttribute("href", "/homes?mode=rent");
      await clearCounters(ip);
    });

    test("a long pause says so, and offers signing in instead of a Try again that can't work", async ({
      page,
    }) => {
      const ip = testIp();
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await gotoHydrated(page, "/about", "main h1");
      await pagesUsedUp(ip);
      const res = await page.goto("/homes?q=Royston");
      expect(res?.status()).toBe(429);
      expect(Number(res?.headers()["retry-after"])).toBeGreaterThan(120);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(LONG_PAUSE);
      await expect(page.locator("main")).not.toContainText(/one moment|for a moment/i);
      await expect(page.locator("main")).toContainText(
        /Listings open again here in about \d+ (hours?|minutes)\./,
      );
      await expect(page.getByTestId("busy-retry")).toHaveCount(0);
      const signInLink = page.getByTestId("busy-sign-in");
      await expect(signInLink).toHaveAttribute(
        "href",
        `/sign-in?next=${encodeURIComponent("/homes?q=Royston")}`,
      );
      await expect(page.getByTestId("busy-phone")).toHaveText(site.phone);
      if (phone) {
        await expectTapTargets(page, "[data-testid=busy-sign-in], [data-testid=busy-back]", 44);
        await expectNoHorizontalOverflow(page);
      }
      // Signing in is the way through: buyers count per account.
      await signInLink.click();
      await page.fill("#email", "buyer@example.com");
      await page.fill("#password", process.env.SEED_PASSWORD ?? "adams-demo-2026");
      await page.click("button[type=submit]");
      await expect(page).toHaveURL(/\/homes\?q=Royston$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Homes for sale in Royston");
      await clearCounters(ip);
    });

    test("the 429 page follows Light, Dark and the device setting, with no contrast or serious axe findings", async ({
      page,
    }) => {
      const ip = testIp();
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await pagesUsedUp(ip);

      // Match my device, light and dark.
      await page.emulateMedia({ colorScheme: "light" });
      expect((await page.goto("/homes"))?.status()).toBe(429);
      expect(await canvas(page)).toBe(LIGHT_CANVAS);
      await expectNoSeriousAxe(page);
      await page.emulateMedia({ colorScheme: "dark" });
      await expect.poll(() => canvas(page)).toBe(DARK_CANVAS);
      await expectNoSeriousAxe(page);

      // Dark chosen on the site, on a light device: the same choice holds here.
      await storePref(page.context(), "dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto("/homes");
      expect(await dataTheme(page)).toBe("dark");
      expect(await canvas(page)).toBe(DARK_CANVAS);
      await expectNoSeriousAxe(page);
      await clearCounters(ip);
    });

    test("the site's own refreshes (here a link inside search) cost a quarter of a page load", async ({
      page,
    }) => {
      const ip = testIp();
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await gotoHydrated(page, "/homes?q=Carnesville&mode=rent", "[data-testid=no-results]");
      const key = `page:1d:${ip}`;
      expect(await counter(key), "a full page load").toBe(PAGE_UNITS);

      let refreshes = 0;
      page.on("request", (r) => {
        const h = r.headers();
        if (new URL(r.url()).pathname === "/homes" && h.rsc === "1" && !h["next-router-prefetch"])
          refreshes++;
      });
      await page
        .getByTestId("no-results")
        .getByRole("link", { name: "See all rentals in Georgia" })
        .click();
      await expect(page).toHaveURL(/\/homes\?mode=rent$/);
      await expect(page.locator("[aria-live=polite]")).toContainText(/\d+ results?/);
      expect(refreshes, "the link was a client-side refresh").toBeGreaterThan(0);
      expect(await counter(key)).toBe(PAGE_UNITS + refreshes);
      await clearCounters(ip);
    });

    test("signed-in buyers aren't turned away by their address's limit; they count per account", async ({
      page,
    }) => {
      const ip = testIp();
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await pagesUsedUp(ip);
      await signIn(page, "buyer@example.com", "/");
      const res = await page.goto("/homes?q=Royston");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Homes for sale in Royston");
      const buyerId = await withDb((db) =>
        db
          .query<{ id: string }>("select id from users where email = $1", ["buyer@example.com"])
          .then((r) => r.rows[0].id),
      );
      expect(await counter(`account:1d:user:${buyerId}`)).toBeGreaterThanOrEqual(PAGE_UNITS);
      await clearCounters(ip);
    });

    test("staff aren't limited at all", async ({ page }) => {
      const ip = testIp();
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await pagesUsedUp(ip);
      await signIn(page, "daniel@adamsrealty.example", "/dashboard");
      expect((await page.goto("/homes"))?.status()).toBe(200);
      const staffCounters = await withDb((db) =>
        db
          .query(
            "select key from rate_limits where key like 'account:%' and key like '%' || (select id from users where email = $1)",
            ["daniel@adamsrealty.example"],
          )
          .then((r) => r.rowCount),
      );
      expect(staffCounters).toBe(0);
      await clearCounters(ip);
    });

    if (!phone) {
      test("LinkedIn's preview robot gets listing pages, even from a busy address; not the API", async ({
        request,
      }) => {
        const ip = testIp();
        await pagesUsedUp(ip);
        const slug = await withDb((db) =>
          db
            .query<{ slug: string }>(
              "select slug from listings where removed_at is null and not idx_hidden and status = 'active' order by id limit 1",
            )
            .then((r) => r.rows[0].slug),
        );
        const preview = await request.get(`/homes/${slug}`, {
          headers: { "user-agent": LINKEDIN, "x-forwarded-for": ip },
        });
        expect(preview.status()).toBe(200);
        expect(await preview.text()).toContain('property="og:title"');
        const api = await request.get("/api/locations/suggest?q=Roy", {
          headers: { "user-agent": LINKEDIN, "x-forwarded-for": ip },
        });
        expect(api.status()).toBe(403);
        await clearCounters(ip);
      });

      test("forged refresh headers get no more than the quick cap; the page allowance stays", async ({
        request,
      }) => {
        const ip = testIp();
        const forged = { "next-url": "/homes", "x-forwarded-for": ip };
        const res = await request.get("/homes", { headers: forged });
        // A full page came back, as it would for a scraper...
        expect(res.status()).toBe(200);
        expect(res.headers()["content-type"]).toContain("text/html");
        // ...counted as a quick request against both windows.
        expect(await counter(`page:1d:${ip}`)).toBe(1);
        expect(await counter(`quick:1d:${ip}`)).toBe(1);
        await setDailyCounter("quick:1d", ip, 6_000);
        expect((await request.get("/homes", { headers: forged })).status()).toBe(429);
        // A plain page load still has its own allowance.
        expect((await request.get("/homes", { headers: { "x-forwarded-for": ip } })).status()).toBe(
          200,
        );
        await clearCounters(ip);
      });

      test("a link-preview name has a small allowance of its own", async ({ request }) => {
        const ip = testIp();
        await setDailyCounter("preview:1d", ip, 500);
        const res = await request.get("/homes", {
          headers: { "user-agent": LINKEDIN, "x-forwarded-for": ip },
        });
        expect(res.status()).toBe(429);
        await clearCounters(ip);
      });

      test("signed-in buyers on one address share one allowance, however many accounts", async ({
        page,
      }) => {
        const ip = testIp();
        await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
        await signIn(page, "buyer@example.com", "/");
        expect(await counter(`members:1d:${ip}`)).toBe(0);
        expect((await page.goto("/homes?q=Royston"))?.status()).toBe(200);
        expect(await counter(`members:1d:${ip}`)).toBeGreaterThanOrEqual(PAGE_UNITS);
        // Every buyer on this address together has used up the day: a fresh account (or
        // this one) is paused, told it's the connection they share (not their account),
        // and not told to sign in.
        await setDailyCounter("members:1d", ip, 5_000 * PAGE_UNITS);
        const res = await page.goto("/homes?q=Royston");
        expect(res?.status()).toBe(429);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(LONG_PAUSE);
        await expect(page.locator("main")).toContainText("from your internet connection");
        await expect(page.locator("main")).toContainText(
          "Everyone signed in on this connection shares one allowance.",
        );
        await expect(page.locator("main")).not.toContainText("your account");
        await expect(
          page.locator("main a[href^='/sign-in'], main a[href^='/sign-up']"),
        ).toHaveCount(0);
        await clearCounters(ip);
      });

      test("an IPv6 client can't dodge the limit by changing its address within its block", async ({
        request,
      }) => {
        // A made-up /48 in the documentation range, and an address in it.
        const hex = () => (Math.floor(Math.random() * 0xefff) + 0x1000).toString(16);
        const site48 = `2001:db8:${hex()}`;
        const other48 = `2001:db8:${hex()}`;
        const get = (ip: string) => request.get("/homes", { headers: { "x-forwarded-for": ip } });
        expect((await get(`${site48}::1`)).status()).toBe(200);
        expect((await get(`${site48}::2`)).status()).toBe(200);
        // Both addresses spent one allowance: their /64's for the minute, their /48's for the day.
        expect(await counter(`page:1m:${site48}:0::/64`)).toBe(2 * PAGE_UNITS);
        expect(await counter(`page:1d:${site48}::/48`)).toBe(2 * PAGE_UNITS);
        expect(await counter(`page:1m:${site48}::1`)).toBe(0);
        // Its day used up: a new address, or a new /64 in the /48, is paused too.
        await setDailyCounter("page:1d", `${site48}::/48`, 5_000 * PAGE_UNITS);
        expect((await get(`${site48}::3`)).status()).toBe(429);
        expect((await get(`${site48}:9:0:0:0:1`)).status()).toBe(429);
        // Someone else's block isn't.
        expect((await get(`${other48}::1`)).status()).toBe(200);
        await withDb((db) =>
          db.query("delete from rate_limits where key like $1 or key like $2", [
            `%:${site48}:%`,
            `%:${other48}:%`,
          ]),
        );
      });

      test("a 'Googlebot' that DNS doesn't confirm is limited like anyone else", async ({
        request,
      }) => {
        const ip = testIp();
        await pagesUsedUp(ip);
        const res = await request.get("/homes", {
          headers: { "user-agent": GOOGLEBOT, "x-forwarded-for": ip },
        });
        expect(res.status()).toBe(429);
        await clearCounters(ip);
      });

      test("with demo-data mode off (this server), sample pages carry no noindex", async ({
        request,
      }) => {
        for (const path of ["/homes", "/areas/royston", "/places", "/agents/andrea-anderegg"]) {
          const res = await request.get(path);
          expect(res.status(), path).toBe(200);
          expect(res.headers()["x-robots-tag"], path).toBeUndefined();
        }
        const robots = await (await request.get("/robots.txt")).text();
        expect(robots).not.toMatch(/^Disallow: \/homes$/m);
      });
    }
  });

  test.describe("spam on the public forms", () => {
    test("a robot that fills the hidden field is thanked as usual, held back, and cleared by an admin", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const email = `hp-${Date.now()}@example.com`;
      const path = await firmListingPath(page);
      await gotoHydrated(page, path, "#c-name");
      await page.fill("#c-name", "Robo Filler");
      await page.fill("#c-email", email);
      await page.locator("input[name=website]").evaluate((el: HTMLInputElement) => {
        el.value = "https://spam.example";
      });
      await waitLikeAPerson(page);
      await page.getByRole("button", { name: "Send tour request" }).click();
      await expect(page.getByText(/Request sent!/)).toBeVisible();

      const held = await latestLead(email);
      expect(held.status).toBe("spam");
      expect(held.agent_id).toBeNull();
      expect(held.metadata.spam).toBe("honeypot");
      expect(held.metadata.routedAgentId).toMatch(/^[0-9a-f-]{36}$/);

      // In the dashboard: not among the open leads; in Spam, flagged, with the reason.
      await signIn(page, "admin@adamsrealty.example", "/dashboard");
      await gotoHydrated(page, "/dashboard/leads", "main h1");
      await expect(page.locator(`main a[href='/dashboard/leads/${held.id}']:visible`)).toHaveCount(
        0,
      );
      await expect(page.getByTestId("spam-count")).toHaveText(/^\d+$/);
      await page.getByRole("link", { name: /^Spam/ }).click();
      await expect(page).toHaveURL(/status=spam/);
      const row = page.locator(`main a[href='/dashboard/leads/${held.id}']:visible`).first();
      await expect(row).toBeVisible();
      await row.click();
      const notice = page.getByTestId("spam-notice");
      await expect(notice).toContainText("Held back as suspected spam");
      await expect(notice).toContainText("Filled in a hidden field that people never see");

      // It's real after all: New puts it back in the open leads, routed to its agent.
      await page.locator("#lead-status").selectOption("new");
      await expect
        .poll(async () => (await latestLead(email)).agent_id)
        .toBe(held.metadata.routedAgentId);
      expect((await latestLead(email)).status).toBe("new");
      await page.reload();
      await expect(page.getByTestId("spam-notice")).toHaveCount(0);
      await deleteLeads(email);
    });

    test("a form whose tab comes back after hours away sends a fresh timer token", async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const email = `back-${Date.now()}@example.com`;
      const tokens: string[] = [];
      page.on("response", async (res) => {
        if (!res.url().includes("/api/form-token")) return;
        tokens.push(((await res.json()) as { token: string }).token);
      });
      await page.clock.install();
      await gotoHydrated(page, "/contact", "#c-name");
      await expect.poll(() => tokens.length).toBeGreaterThan(0);
      await page.waitForTimeout(500);
      const opened = tokens.length;
      const comeBack = () =>
        page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      // An hour away: the token still has most of its day, so it's kept.
      await page.clock.fastForward("01:00:00");
      await comeBack();
      await page.waitForTimeout(500);
      expect(tokens).toHaveLength(opened);
      // Thirteen hours away: a fresh one, which is what the form then sends.
      await page.clock.fastForward("12:00:00");
      await comeBack();
      await expect.poll(() => tokens.length).toBe(opened + 1);
      const fresh = tokens.at(-1)!;
      await page.fill("#c-name", "Back Again");
      await page.fill("#c-email", email);
      await waitLikeAPerson(page);
      const sent = page.waitForRequest(
        (r) => r.method() === "POST" && (r.postData() ?? "").includes(fresh),
      );
      await page.getByRole("button", { name: "Send message" }).click();
      await sent;
      await expect(page.getByText(/Thanks/).first()).toBeVisible();
      expect((await latestLead(email)).status).toBe("new");
      await deleteLeads(email);
    });

    test("a form sent faster than a person types is held back", async ({ page }) => {
      const email = `fast-${Date.now()}@example.com`;
      await gotoHydrated(page, "/contact", "#c-name");
      await page.fill("#c-name", "Speedy Script");
      await page.fill("#c-email", email);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText(/Message sent!|Thanks/).first()).toBeVisible();
      const lead = await latestLead(email);
      expect(lead.status).toBe("spam");
      expect(lead.metadata.spam).toContain("too-fast");
      await deleteLeads(email);
    });

    test("an SEO pitch with a link from a stranger is held back; a person's question isn't", async ({
      page,
    }) => {
      const spammer = `pitch-${Date.now()}@example.com`;
      await gotoHydrated(page, "/contact", "#c-name");
      await page.fill("#c-name", "Growth Team");
      await page.fill("#c-email", spammer);
      await page.fill(
        "#c-message",
        "Your website isn't showing up in Google's index. We can improve your search visibility: https://rank.example/audit",
      );
      await waitLikeAPerson(page);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText(/Thanks/).first()).toBeVisible();
      const pitch = await latestLead(spammer);
      expect(pitch.status).toBe("spam");
      expect(pitch.metadata.spam).toBe("seo-pitch");

      const person = `person-${Date.now()}@example.com`;
      await gotoHydrated(page, "/contact", "#c-name");
      await page.fill("#c-name", "Riley Buyer");
      await page.fill("#c-email", person);
      await page.fill(
        "#c-message",
        "Is this one still available? https://www.zillow.com/homedetails/123 We're moving from Atlanta.",
      );
      await waitLikeAPerson(page);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText(/Thanks/).first()).toBeVisible();
      expect((await latestLead(person)).status).toBe("new");
      await deleteLeads(spammer);
      await deleteLeads(person);
    });

    test("over the per-address limit, the form says to wait and nothing is sent", async ({
      page,
    }) => {
      const ip = testIp();
      const email = `limited-${Date.now()}@example.com`;
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await setDailyCounter("inquiry-ip:1d", ip, 30);
      await gotoHydrated(page, "/contact", "#c-name");
      await page.fill("#c-name", "Busy Sender");
      await page.fill("#c-email", email);
      await waitLikeAPerson(page);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText(/You've sent several messages in a row/)).toBeVisible();
      await expect(page.getByText(site.phone).first()).toBeVisible();
      expect(await latestLead(email)).toBeUndefined();
      await clearCounters(ip);
    });

    test("sign-up refuses a robot that fills the hidden field, then lets a person in", async ({
      page,
    }) => {
      const email = `signup-${Date.now()}@example.com`;
      const userCount = () =>
        withDb((db) =>
          db
            .query<{ n: number }>("select count(*)::int as n from users where email = $1", [email])
            .then((r) => r.rows[0].n),
        );
      await gotoHydrated(page, "/sign-up?next=/saved", "#email");
      await page.fill("#name", "Robo Signup");
      await page.fill("#email", email);
      await page.fill("#password", "correct-horse-battery");
      await page.locator("input[name=website]").evaluate((el: HTMLInputElement) => {
        el.value = "https://spam.example";
      });
      await waitLikeAPerson(page, 2_300);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByText(/couldn't create your account just now/)).toBeVisible();
      expect(await userCount()).toBe(0);

      await expect(page.locator("input[name=website]")).toHaveValue("");
      await page.fill("#name", "Pat Person");
      await page.fill("#email", email);
      await page.fill("#password", "correct-horse-battery");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/saved");
      expect(await userCount()).toBe(1);
      await withDb((db) => db.query("delete from users where email = $1", [email]));
    });

    test("saving a search refuses the hidden field, then saves for a person", async ({ page }) => {
      await signIn(page, "buyer@example.com", "/");
      const searches = () =>
        withDb((db) =>
          db
            .query<{ id: string }>(
              `select s.id from saved_searches s join users u on u.id = s.user_id
                where u.email = 'buyer@example.com' and s.name = 'E2E spam check'`,
            )
            .then((r) => r.rows),
        );
      await gotoHydrated(page, "/homes?q=Carnesville&mode=rent", "[data-testid=no-results]");
      await page.getByRole("button", { name: "Email me when rentals list here" }).click();
      const dialog = page.getByRole("dialog", { name: "Save this search" });
      await dialog.locator("#search-name").fill("E2E spam check");
      await dialog.locator("input[name=website]").evaluate((el: HTMLInputElement) => {
        el.value = "x";
      });
      await waitLikeAPerson(page, 2_300);
      await dialog.getByRole("button", { name: "Save search" }).click();
      await expect(
        dialog.getByText("We couldn't save that search. Please try again."),
      ).toBeVisible();
      expect(await searches()).toHaveLength(0);

      // The form starts over after a refusal: the name again, and no hidden field.
      await dialog.locator("#search-name").fill("E2E spam check");
      await expect(dialog.locator("input[name=website]")).toHaveValue("");
      await dialog.getByRole("button", { name: "Save search" }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(async () => (await searches()).length).toBe(1);
      await withDb((db) => db.query("delete from saved_searches where name = 'E2E spam check'"));
    });
  });
}
