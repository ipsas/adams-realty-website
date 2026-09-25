import { type BrowserContext, type Page, expect, type test as baseTest } from "@playwright/test";
import { signIn } from "./helpers";
import { expectNoSeriousAxe, gotoHydrated } from "./mobile/helpers";

/*
 * Shared dark-mode cases (docs/plans/dark-mode-and-georgia.md, DM5). e2e/theme.spec.ts runs
 * them on desktop and e2e/mobile/theme.spec.ts on the phone projects. Not a spec file itself.
 */

export const KEY = "ar:theme";
export const LIGHT_CANVAS = "rgb(251, 250, 247)";
export const DARK_CANVAS = "rgb(15, 20, 18)";
export const LIGHT_INK = "rgb(21, 32, 28)";

export const dataTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));
export const canvas = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
export const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
/** The first theme-color meta: the one the browser uses when its media (if any) allows. */
export const firstThemeColor = (page: Page) =>
  page.evaluate(() => {
    const m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    return { content: m?.content, media: m?.getAttribute("media") ?? null };
  });

/**
 * Stores `pref` the way the switch writes it, before the first document of the context
 * loads. Only once per tab, so a later choice in the test is not undone by a reload.
 */
export async function storePref(context: BrowserContext, pref: "light" | "dark") {
  await context.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem("seeded", "1");
      }
    },
    [KEY, pref] as const,
  );
}

/** Forces Dark on every document the context loads (for suites that never change it). */
export async function forceDark(context: BrowserContext) {
  await context.addInitScript((key) => localStorage.setItem(key, '"dark"'), KEY);
}

/* ───────────────────────── the dark axe matrix ───────────────────────── */

type Role = "buyer" | "staff";
const ACCOUNTS: Record<Role, { email: string; home: string }> = {
  buyer: { email: "buyer@example.com", home: "/" },
  staff: { email: "admin@adamsrealty.example", home: "/dashboard" },
};

export type AxePage = {
  name: string;
  /** A fixed path, or a function that finds one (the first listing, the first guide). */
  path: string | ((page: Page) => Promise<string>);
  /** Hydrated and visible before axe runs. */
  ready: string;
  role?: Role;
};

async function firstLink(page: Page, from: string, selector: string, pattern: RegExp) {
  await page.goto(from);
  const href = await page.locator(selector).first().getAttribute("href");
  expect(href).toMatch(pattern);
  return href!;
}

export const firstListingPath = (page: Page) =>
  firstLink(page, "/homes", "article a[href^='/homes/']", /^\/homes\/[a-z0-9-]+$/);
const firstGuidePath = (page: Page) =>
  firstLink(page, "/areas", "main a[href^='/areas/']", /^\/areas\/[a-z0-9-]+$/);

const PAGES = {
  home: { name: "/", path: "/", ready: "main h1" },
  homes: { name: "/homes", path: "/homes", ready: "[aria-live=polite]" },
  listing: { name: "a listing", path: firstListingPath, ready: "main p.tabular" },
  signIn: { name: "/sign-in", path: "/sign-in", ready: "#email" },
  about: { name: "/about", path: "/about", ready: "main h1" },
  contact: { name: "/contact", path: "/contact", ready: "#c-name" },
  sell: { name: "/sell", path: "/sell", ready: "main h1" },
  areas: { name: "/areas", path: "/areas", ready: "main h1" },
  guide: { name: "an area guide", path: firstGuidePath, ready: "main h1" },
  fairHousing: { name: "/fair-housing", path: "/fair-housing", ready: "main h1" },
  saved: { name: "/saved", path: "/saved", ready: "main h1", role: "buyer" },
  account: { name: "/account", path: "/account", ready: "main h1", role: "buyer" },
  dashboard: { name: "/dashboard", path: "/dashboard", ready: "main h1", role: "staff" },
  leads: { name: "/dashboard/leads", path: "/dashboard/leads", ready: "main h1", role: "staff" },
  listings: {
    name: "/dashboard/listings",
    path: "/dashboard/listings",
    ready: "main h1",
    role: "staff",
  },
} satisfies Record<string, AxePage>;

/** Every page with its own design, signed in as the role that sees it (desktop). */
export const DARK_AXE_PAGES: AxePage[] = Object.values(PAGES);

/** The same pages on phones, where the dashboard's tables and lead cards also render. */
export const DARK_AXE_PHONE_PAGES: AxePage[] = Object.values(PAGES);

/** Pages checked again with no stored choice and a dark OS (Match my device). */
export const SYSTEM_DARK_PAGES: AxePage[] = [PAGES.home, PAGES.homes, PAGES.listing];

async function visitDark(page: Page, p: AxePage) {
  if (p.role) await signIn(page, ACCOUNTS[p.role].email, ACCOUNTS[p.role].home);
  const path = typeof p.path === "string" ? p.path : await p.path(page);
  await gotoHydrated(page, path, p.ready);
  await expect(page.locator(p.ready).first()).toBeVisible();
  // Settle entrance transitions so axe reads final colours.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  expect(await canvas(page), `${path} is dark`).toBe(DARK_CANVAS);
}

/**
 * Registers the dark axe matrix: 0 color-contrast violations and no un-allowlisted serious
 * or critical finding, with Dark forced over a light OS, and with a dark OS and no choice.
 * Contrast can never be allowlisted (expectNoSeriousAxe enforces it).
 */
export function darkAxeSuite(
  test: typeof baseTest,
  { pages, systemPages }: { pages: AxePage[]; systemPages: AxePage[] },
) {
  test.describe("dark mode: no contrast or serious axe findings", () => {
    test.describe.configure({ timeout: 90_000 });

    for (const p of pages) {
      test(`${p.name}, Dark forced`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: "light" });
        await forceDark(page.context());
        await visitDark(page, p);
        expect(await dataTheme(page)).toBe("dark");
        await expectNoSeriousAxe(page);
      });
    }

    for (const p of systemPages) {
      test(`${p.name}, dark OS with Match my device`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: "dark" });
        await visitDark(page, p);
        expect(await dataTheme(page)).toBeNull();
        await expectNoSeriousAxe(page);
      });
    }
  });
}
