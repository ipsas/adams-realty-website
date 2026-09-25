import {
  type BrowserContext,
  type Locator,
  type Page,
  expect,
  type test as baseTest,
} from "@playwright/test";
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

/* ───────────────────────── printing ───────────────────────── */

/**
 * Mean relative luminance (0 black … 1 white) of what `locator` shows right now, from a
 * screenshot, so it sees the map canvas exactly as the page renders it under the current
 * emulated media. Decoded in the page with an offscreen canvas.
 */
export async function meanLuminance(page: Page, locator: Locator) {
  const png = (await locator.screenshot({ animations: "disabled" })).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    let sum = 0;
    for (let i = 0; i < d.length; i += 4)
      sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    return sum / (d.length / 4);
  }, png);
}

/** Every element's colours outside the maps (checked by their pixels), keyed by position. */
const printedColours = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string> = {};
    document.querySelectorAll("body *").forEach((el, i) => {
      if (el.closest(".maplibregl-map")) return;
      const cs = getComputedStyle(el);
      out[`${i} ${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`] = [
        cs.color,
        cs.backgroundColor,
        cs.backgroundImage,
        cs.borderTopColor,
        cs.borderBottomColor,
        cs.boxShadow,
        cs.fill,
        cs.stroke,
      ].join(" | ");
    });
    return out;
  });

/**
 * A listing printed with Dark forced on a dark OS prints exactly like one printed in Light,
 * map included. The page is dark on screen first, with its location map drawn dark, so the
 * check can tell a dark printout from a light one.
 */
export async function expectListingPrintsLight(page: Page) {
  await page.emulateMedia({ media: "screen", colorScheme: "dark" });
  await forceDark(page.context());
  const path = await firstListingPath(page);
  await gotoHydrated(page, path, "main p.tabular");
  await page.getByRole("heading", { name: "Location" }).scrollIntoViewIfNeeded();
  const map = page.locator(".maplibregl-map");
  await expect(map).toHaveAttribute("data-map-style", "dark", { timeout: 20_000 });
  expect(await meanLuminance(page, map), "the map is dark on screen").toBeLessThan(0.1);
  // Colours are read at their end state, not mid-transition.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important }" });

  // Hold the light style back until the print fallback has been checked: a real print can't
  // wait for a map to restyle, so until it has, the dark canvas must not print.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let lightRequested = false;
  await page.route(/styles\/positron/, async (route) => {
    lightRequested = true;
    await held;
    await route.continue();
  });
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  expect(await dataTheme(page)).toBe("dark");
  expect(await canvas(page)).toBe(LIGHT_CANVAS);
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(LIGHT_INK);

  // Nothing prints in a dark colour: every element matches the same page printed in Light.
  const printedDark = await printedColours(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  const printedLight = await printedColours(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  expect(Object.keys(printedDark).length).toBeGreaterThan(100);
  const differences = Object.keys(printedLight)
    .filter((k) => printedDark[k] !== printedLight[k])
    .map((k) => `${k}: ${printedDark[k]} (Dark) vs ${printedLight[k]} (Light)`);
  expect(differences).toEqual([]);

  // The map never prints dark. Until its light style is drawn, no canvas prints (just the
  // light map panel); then it redraws in its light style, which prints.
  await expect.poll(() => lightRequested, "the map asks for its light style").toBe(true);
  expect(await map.getAttribute("data-map-style")).not.toBe("light");
  expect(
    await map.locator(".maplibregl-canvas").evaluate((c) => getComputedStyle(c).visibility),
  ).toBe("hidden");
  expect(await meanLuminance(page, map), "the printed map, restyling").toBeGreaterThan(0.6);
  release();
  await expect(map).toHaveAttribute("data-map-style", "light", { timeout: 20_000 });
  await expect(map.locator(".maplibregl-canvas")).toBeVisible();
  expect(await meanLuminance(page, map), "the printed map, redrawn").toBeGreaterThan(0.6);

  // Back on screen, it is dark again.
  await page.emulateMedia({ media: "screen", colorScheme: "dark" });
  await expect(map).toHaveAttribute("data-map-style", "dark", { timeout: 20_000 });
  expect(await meanLuminance(page, map)).toBeLessThan(0.1);
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
