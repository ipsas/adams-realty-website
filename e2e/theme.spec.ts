import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";

/**
 * Dark mode, DM1: the mechanism without the switch UI (DM3 adds it). The stored
 * preference is set the way the switch will write it: localStorage["ar:theme"].
 */

const KEY = "ar:theme";
const LIGHT_CANVAS = "rgb(251, 250, 247)";
const DARK_CANVAS = "rgb(15, 20, 18)";
const LIGHT_INK = "rgb(21, 32, 28)";

async function storePref(context: BrowserContext, pref: "light" | "dark") {
  // Only on the first document, so later writes in the test are not undone by reloads.
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

const canvas = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const dataTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const firstThemeColor = (page: Page) =>
  page.evaluate(() => {
    const m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    return { content: m?.content, media: m?.getAttribute("media") ?? null };
  });

type ContextOptions = NonNullable<Parameters<Browser["newContext"]>[0]>;
function newContext(browser: Browser, baseURL: string | undefined, options: ContextOptions) {
  return browser.newContext({ ...options, baseURL });
}

test.describe("no flash", () => {
  test("a stored Dark is painted by the head script alone, before any app JS", async ({
    browser,
    baseURL,
  }) => {
    const context = await newContext(browser, baseURL, { colorScheme: "light" });
    await storePref(context, "dark");
    const page = await context.newPage();
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await page.goto("/");
    expect(await dataTheme(page)).toBe("dark");
    expect(await canvas(page)).toBe(DARK_CANVAS);
    expect(await firstThemeColor(page)).toEqual({ content: "#0f1412", media: null });
    await context.close();
  });

  test("the server HTML has no data-theme, and its first inline script reads ar:theme in <head>", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();
    const htmlTag = html.match(/<html\b[^>]*>/)?.[0] ?? "";
    expect(htmlTag).not.toContain("data-theme");
    const head = html.slice(0, html.indexOf("<body"));
    const inline = [...head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(
      ([, attrs]) => !/\bsrc=/.test(attrs),
    );
    expect(inline.length).toBeGreaterThan(0);
    expect(inline[0][2]).toContain(KEY);
    // Both theme-colors are server-rendered, one per scheme.
    expect(head).toMatch(
      /<meta name="theme-color" content="#fbfaf7" media="\(prefers-color-scheme: light\)"/,
    );
    expect(head).toMatch(
      /<meta name="theme-color" content="#0f1412" media="\(prefers-color-scheme: dark\)"/,
    );
  });
});

test.describe("Match my device", () => {
  for (const [scheme, expected] of [
    ["dark", DARK_CANVAS],
    ["light", LIGHT_CANVAS],
  ] as const) {
    test(`with JavaScript off, a ${scheme} OS gets the ${scheme} canvas`, async ({
      browser,
      baseURL,
    }) => {
      const context = await newContext(browser, baseURL, {
        javaScriptEnabled: false,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      await page.goto("/");
      expect(await dataTheme(page)).toBeNull();
      expect(await canvas(page)).toBe(expected);
      await context.close();
    });
  }

  test("follows the OS live, with no attribute and no override meta", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("header").first()).toBeVisible();
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => canvas(page)).toBe(DARK_CANVAS);
    expect(await dataTheme(page)).toBeNull();
    expect(await page.locator("#theme-color-override").count()).toBe(0);
  });
});

test("a forced Light stays light under a dark OS", async ({ browser, baseURL }) => {
  const context = await newContext(browser, baseURL, { colorScheme: "dark" });
  await storePref(context, "light");
  const page = await context.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(await dataTheme(page)).toBe("light");
  expect(await canvas(page)).toBe(LIGHT_CANVAS);
  expect(await firstThemeColor(page)).toEqual({ content: "#fbfaf7", media: null });
  await context.close();
});

test("printing is light even with Dark forced on a dark OS", async ({ browser, baseURL }) => {
  const context = await newContext(browser, baseURL, { colorScheme: "dark" });
  await storePref(context, "dark");
  const page = await context.newPage();
  await page.goto("/about");
  expect(await canvas(page)).toBe(DARK_CANVAS);
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  expect(await dataTheme(page)).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(LIGHT_INK);
  expect(await canvas(page)).toBe(LIGHT_CANVAS);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    "light",
  );
  await context.close();
});

test("after hydration the stored Dark is kept, with no console errors", async ({
  browser,
  baseURL,
}) => {
  const context = await newContext(browser, baseURL, { colorScheme: "light" });
  await storePref(context, "dark");
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    // WebGL driver chatter from the map is not ours; React and Next warnings are.
    if (
      m.type() === "error" ||
      (m.type() === "warning" && !/WebGL|GL Driver|layers\[/.test(m.text()))
    )
      problems.push(`${m.type()}: ${m.text()}`);
  });
  for (const path of ["/", "/about", "/homes"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await dataTheme(page), path).toBe("dark");
    expect(await canvas(page), path).toBe(DARK_CANVAS);
    expect(await firstThemeColor(page), path).toEqual({ content: "#0f1412", media: null });
    expect(await page.locator("#theme-color-override").count(), path).toBe(1);
  }
  // A client-side navigation keeps it too.
  await page.goto("/");
  await page.getByRole("link", { name: "Buy", exact: true }).first().click();
  await expect(page).toHaveURL(/\/homes/);
  expect(await dataTheme(page)).toBe("dark");
  expect(problems).toEqual([]);
  await context.close();
});

test("another tab's change is followed live", async ({ browser, baseURL }) => {
  const context = await newContext(browser, baseURL, { colorScheme: "light" });
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto("/about");
  await b.goto("/about");
  await b.waitForLoadState("networkidle");
  expect(await canvas(b)).toBe(LIGHT_CANVAS);

  await a.evaluate((key) => localStorage.setItem(key, '"dark"'), KEY);
  await expect.poll(() => dataTheme(b)).toBe("dark");
  expect(await canvas(b)).toBe(DARK_CANVAS);
  expect(await firstThemeColor(b)).toEqual({ content: "#0f1412", media: null });

  // Back to Match my device: the attribute and the override meta go.
  await a.evaluate((key) => localStorage.removeItem(key), KEY);
  await expect.poll(() => dataTheme(b)).toBeNull();
  expect(await canvas(b)).toBe(LIGHT_CANVAS);
  expect(await b.locator("#theme-color-override").count()).toBe(0);
  await context.close();
});

/* ───────────────────────── DM3: the switch ───────────────────────── */

const themeKey = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

async function openAppearanceMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "Appearance", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("group", { name: "Appearance" })).toBeVisible();
  return trigger;
}

test.describe("the header's appearance menu", () => {
  test("Dark, Light and Match my device each apply at once, persist and update theme-color", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/about");
    await page.waitForLoadState("networkidle");
    await openAppearanceMenu(page);
    const group = page.getByRole("group", { name: "Appearance" });
    await expect(group.getByRole("radio", { name: "Match my device" })).toBeChecked();

    await group.getByRole("radio", { name: "Dark" }).check();
    expect(await dataTheme(page)).toBe("dark");
    expect(await canvas(page)).toBe(DARK_CANVAS);
    expect(await firstThemeColor(page)).toEqual({ content: "#0f1412", media: null });
    expect(await themeKey(page)).toBe('"dark"');
    // Choosing leaves the menu open, with the choice checked.
    await expect(group.getByRole("radio", { name: "Dark" })).toBeChecked();

    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(await dataTheme(page)).toBe("dark");
    await page.getByRole("link", { name: "Buy", exact: true }).first().click();
    await expect(page).toHaveURL(/\/homes/);
    expect(await dataTheme(page)).toBe("dark");
    expect(await canvas(page)).toBe(DARK_CANVAS);

    // A forced Light under a dark OS: light canvas, light chrome colour.
    await page.emulateMedia({ colorScheme: "dark" });
    await openAppearanceMenu(page);
    await page.getByRole("radio", { name: "Light" }).check();
    expect(await dataTheme(page)).toBe("light");
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
    expect(await firstThemeColor(page)).toEqual({ content: "#fbfaf7", media: null });
    expect(await themeKey(page)).toBe('"light"');

    // Match my device: no key, no attribute, no override; the OS (dark here) decides.
    await page.getByRole("radio", { name: "Match my device" }).check();
    expect(await themeKey(page)).toBeNull();
    expect(await dataTheme(page)).toBeNull();
    expect(await page.locator("#theme-color-override").count()).toBe(0);
    expect(await canvas(page)).toBe(DARK_CANVAS);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => canvas(page)).toBe(LIGHT_CANVAS);
  });

  test("works from the keyboard: Enter opens, arrows choose, Escape returns focus", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/about");
    await page.waitForLoadState("networkidle");
    const trigger = page.getByRole("button", { name: "Appearance", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Tab enters the radio group on its checked option.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "Match my device" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(await dataTheme(page)).toBe("light");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(await dataTheme(page)).toBe("dark");
    // The focused option shows the focus ring.
    const outline = await page
      .getByRole("radio", { name: "Dark" })
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(await dataTheme(page)).toBe("dark");
  });

  test("desktop has the header button and no phone menu; it adds no live region to /homes", async ({
    page,
  }) => {
    await page.goto("/homes");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
    await openAppearanceMenu(page);
    await expect(page.locator("[aria-live=polite]")).toHaveCount(1);
  });
});

/* ───────────────────────── DM4: maps ───────────────────────── */

type MapProbe = { style: boolean; layers: string[]; rendered: number } | null;
const OVERLAY_LAYERS = ["clusters", "cluster-count", "pin-dots", "pins", "pins-active"];

/** Reads the dev-only window.__searchMap: style loaded, overlay layers present, pins drawn. */
const probeSearchMap = (page: Page) =>
  page.evaluate((ids): MapProbe => {
    type M = {
      isStyleLoaded(): boolean;
      getLayer(id: string): unknown;
      queryRenderedFeatures(o: { layers: string[] }): unknown[];
    };
    const map = (window as unknown as { __searchMap?: M }).__searchMap;
    if (!map) return null;
    const layers = ids.filter((id) => map.getLayer(id));
    return {
      style: map.isStyleLoaded(),
      layers,
      rendered:
        layers.length === ids.length
          ? map.queryRenderedFeatures({ layers: ["clusters", "pin-dots", "pins"] }).length
          : 0,
    };
  }, OVERLAY_LAYERS);

const mapReady = async (page: Page) => {
  const p = await probeSearchMap(page);
  return !!p && p.style && p.layers.length === OVERLAY_LAYERS.length && p.rendered > 0;
};

test("the search map swaps to the dark style and back, keeping its pins", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    // As above: WebGL driver chatter is not ours; MapLibre's warnings (a missing image) are.
    if (
      m.type() === "error" ||
      (m.type() === "warning" && !/WebGL|GL Driver|layers\[/.test(m.text()))
    )
      problems.push(`${m.type()}: ${m.text()}`);
  });
  const failed: string[] = [];
  page.on("response", (r) => {
    if (/tiles\.openfreemap\.org\/(styles|fonts|sprites)\//.test(r.url()) && r.status() >= 400)
      failed.push(`${r.status()} ${r.url()}`);
  });
  const styles: string[] = [];
  page.on("request", (r) => {
    if (/\/styles\//.test(r.url())) styles.push(r.url());
  });

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/homes");
  await expect.poll(() => mapReady(page), { timeout: 20_000 }).toBe(true);
  expect(styles.some((u) => /styles\/positron/.test(u))).toBe(true);
  expect(styles.filter((u) => /styles\/dark/.test(u))).toEqual([]);

  await openAppearanceMenu(page);
  const dark = page.waitForRequest(/styles\/dark/);
  await page.getByRole("radio", { name: "Dark" }).check();
  await dark;
  await expect.poll(() => mapReady(page), { timeout: 20_000 }).toBe(true);
  // The same map, restyled: not a second canvas.
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);

  const light = page.waitForRequest(/styles\/positron/);
  await page.getByRole("radio", { name: "Light" }).check();
  await light;
  await expect.poll(() => mapReady(page), { timeout: 20_000 }).toBe(true);
  expect(failed).toEqual([]);
  expect(problems).toEqual([]);
});

test("a dark page creates its maps on the dark style, never the light one first", async ({
  browser,
  baseURL,
}) => {
  const context = await newContext(browser, baseURL, { colorScheme: "light" });
  await storePref(context, "dark");
  const page = await context.newPage();
  const styles: string[] = [];
  page.on("request", (r) => {
    if (/\/styles\//.test(r.url())) styles.push(r.url());
  });
  await page.goto("/homes");
  await expect.poll(() => mapReady(page), { timeout: 20_000 }).toBe(true);
  const href = await page.locator("article a[href^='/homes/']").first().getAttribute("href");
  expect(href).toMatch(/^\/homes\/[a-z0-9-]+$/);

  // The listing's location map follows too.
  await page.goto(href!);
  await page.getByRole("heading", { name: "Location" }).scrollIntoViewIfNeeded();
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
  await expect.poll(() => styles.length).toBeGreaterThanOrEqual(2);
  expect(
    styles.filter((u) => !/styles\/dark/.test(u)),
    "light style requested on a dark page",
  ).toEqual([]);

  // Switching to Light rebuilds it on the light style.
  const light = page.waitForRequest(/styles\/positron/);
  await openAppearanceMenu(page);
  await page.getByRole("radio", { name: "Light" }).check();
  await light;
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
  await context.close();
});
