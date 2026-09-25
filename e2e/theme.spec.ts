import AxeBuilder from "@axe-core/playwright";
import { type Browser, type Locator, type Page, expect, test } from "@playwright/test";
import {
  DARK_AXE_PAGES,
  DARK_CANVAS,
  KEY,
  LIGHT_CANVAS,
  LIGHT_INK,
  SYSTEM_DARK_PAGES,
  canvas,
  darkAxeSuite,
  dataTheme,
  expectListingPrintsLight,
  firstThemeColor,
  forceDark,
  storePref,
  stored,
} from "./theme-suite";

/**
 * Dark mode on desktop: the mechanism (DM1), the header switch (DM3), the maps (DM4) and the
 * dark axe matrix (DM5). Shared cases and helpers live in theme-suite.ts; the phone projects
 * run e2e/mobile/theme.spec.ts. The stored preference is localStorage["ar:theme"].
 */

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

  test("at DOMContentLoaded, before hydration, the canvas is already the stored theme", async ({
    browser,
    baseURL,
  }) => {
    for (const [pref, os, expected] of [
      ["dark", "light", DARK_CANVAS],
      ["light", "dark", LIGHT_CANVAS],
    ] as const) {
      const context = await newContext(browser, baseURL, { colorScheme: os });
      await storePref(context, pref);
      // Records the first frame's state: the attribute, the body's computed background and
      // whether React has touched the body yet (it must not have).
      await context.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const body = document.body;
          (window as unknown as { __dcl: unknown }).__dcl = {
            theme: document.documentElement.getAttribute("data-theme"),
            canvas: getComputedStyle(body).backgroundColor,
            hydrated: Object.keys(body).some((k) => k.startsWith("__react")),
          };
        });
      });
      const page = await context.newPage();
      await page.goto("/about");
      const dcl = await page.evaluate(() => (window as unknown as { __dcl: unknown }).__dcl);
      expect(dcl, `${pref} over a ${os} OS`).toEqual({
        theme: pref,
        canvas: expected,
        hydrated: false,
      });
      await context.close();
    }
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

test("a listing printed in Dark prints light, its location map included", async ({ page }) => {
  test.setTimeout(90_000);
  await expectListingPrintsLight(page);
});

test("the primary button's hover follows the theme", async ({ browser, baseURL }) => {
  for (const [pref, rest, hover] of [
    ["light", "rgb(26, 76, 57)", "rgb(22, 61, 47)"],
    ["dark", "rgb(47, 117, 88)", "rgb(31, 93, 69)"],
  ] as const) {
    const context = await newContext(browser, baseURL, { colorScheme: "light" });
    await storePref(context, pref);
    const page = await context.newPage();
    await page.goto("/sign-in");
    const submit = page.locator("form:has(#email) button[type=submit]");
    await expect(submit).toBeVisible();
    const fill = () => submit.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.move(0, 0);
    await expect.poll(fill, `${pref} at rest`).toBe(rest);
    await submit.hover();
    await expect.poll(fill, `${pref} hovered`).toBe(hover);
    await context.close();
  }
});

test("an area guide's chart tooltip is readable in Dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await forceDark(page.context());
  await page.goto("/areas");
  const href = await page.locator("main a[href^='/areas/']").first().getAttribute("href");
  expect(href).toMatch(/^\/areas\/[a-z0-9-]+$/);
  await page.goto(href!);
  const segment = page.locator(TOOLTIP_SEGMENT);
  await segment.scrollIntoViewIfNeeded();
  await segment.hover();
  // axe skips invisible text, so wait for the tooltip to finish fading in.
  await expect
    .poll(() => segment.locator(":scope > span").evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1");
  const results = await new AxeBuilder({ page })
    .include(`${TOOLTIP_SEGMENT} > span`)
    .withRules(["color-contrast"])
    .analyze();
  expect(
    results.violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`)),
  ).toEqual([]);
  // Both lines of the tooltip were checked, not skipped as hidden.
  expect(results.passes.flatMap((v) => v.nodes).length).toBeGreaterThanOrEqual(2);
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

/** The first segment of an area guide's "What's for sale" bar; its tooltip shows on hover. */
const TOOLTIP_SEGMENT = "section[aria-labelledby=type-mix-heading] [role=img] > div:first-child";

const fillOf = (el: Locator) => el.evaluate((e) => getComputedStyle(e).backgroundColor);

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
    const trigger = page.getByRole("button", { name: "Appearance", exact: true });
    // The trigger shows the sun in light and the moon in dark, never both.
    await expect(trigger.locator("svg.lucide-sun")).toBeVisible();
    await expect(trigger.locator("svg.lucide-moon")).toBeHidden();
    expect(await fillOf(trigger), "no disc at rest").toBe("rgba(0, 0, 0, 0)");
    await openAppearanceMenu(page);
    // Open, it sits on a sunken disc, as in the approved preview.
    await page.mouse.move(0, 0);
    await expect.poll(() => fillOf(trigger)).toBe("rgb(244, 242, 236)");
    const group = page.getByRole("group", { name: "Appearance" });
    await expect(group.getByRole("radio", { name: "Match my device" })).toBeChecked();
    // The chosen row is filled; the others are not.
    const row = (name: string) =>
      group.locator("label").filter({ has: page.getByRole("radio", { name, exact: true }) });
    expect(await fillOf(row("Match my device"))).toBe("rgb(244, 242, 236)");
    expect(await fillOf(row("Dark"))).toBe("rgba(0, 0, 0, 0)");

    await group.getByRole("radio", { name: "Dark" }).check();
    expect(await dataTheme(page)).toBe("dark");
    await expect(trigger.locator("svg.lucide-moon")).toBeVisible();
    await expect(trigger.locator("svg.lucide-sun")).toBeHidden();
    await page.mouse.move(0, 0);
    await expect.poll(() => fillOf(row("Dark"))).toBe("rgb(11, 15, 13)");
    expect(await fillOf(row("Match my device"))).toBe("rgba(0, 0, 0, 0)");
    await expect.poll(() => fillOf(trigger)).toBe("rgb(11, 15, 13)");
    expect(await canvas(page)).toBe(DARK_CANVAS);
    expect(await firstThemeColor(page)).toEqual({ content: "#0f1412", media: null });
    expect(await stored(page)).toBe('"dark"');
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
    expect(await stored(page)).toBe('"light"');

    // Match my device: no key, no attribute, no override; the OS (dark here) decides.
    await page.getByRole("radio", { name: "Match my device" }).check();
    expect(await stored(page)).toBeNull();
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

  test("over the home hero, the open trigger is a surface disc in both themes", async ({
    browser,
    baseURL,
  }) => {
    for (const [pref, surface, ink] of [
      ["light", "rgb(255, 255, 255)", "rgb(21, 32, 28)"],
      ["dark", "rgb(23, 30, 27)", "rgb(236, 235, 228)"],
    ] as const) {
      const context = await newContext(browser, baseURL, { colorScheme: "light" });
      await storePref(context, pref);
      const page = await context.newPage();
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      const trigger = page.getByRole("button", { name: "Appearance", exact: true });
      const look = () =>
        trigger.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
      // At rest: no disc, a white icon on the photo, as in the approved preview.
      expect(await look(), `${pref} at rest`).toEqual(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"]);
      await trigger.click();
      await page.mouse.move(0, 0);
      await expect.poll(look, `${pref} open`).toEqual([surface, ink]);
      await context.close();
    }
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

type Base = "light" | "dark";
type MapProbe = {
  style: boolean;
  base: Base | "other";
  layers: string[];
  rendered: number;
  pins: number;
} | null;
const OVERLAY_LAYERS = ["clusters", "cluster-count", "pin-dots", "pins", "pins-active"];

/**
 * Reads the dev-only window.__searchMap: style loaded, overlay layers present, and how many
 * features are drawn (clusters and pins together, and on the price-pill `pins` layer alone).
 * `base` tells the applied base style apart by its background layer (OpenFreeMap positron
 * is rgb(242,243,240), dark rgb(12,12,12)), so a check can't pass on the style being replaced.
 */
const probeSearchMap = (page: Page) =>
  page.evaluate(async (ids): Promise<MapProbe> => {
    type M = {
      isStyleLoaded(): boolean;
      getLayer(id: string): unknown;
      getPaintProperty(layer: string, name: string): unknown;
      queryRenderedFeatures(o: { layers: string[] }): unknown[];
      once(e: string, cb: () => void): void;
      triggerRepaint(): void;
    };
    const map = (window as unknown as { __searchMap?: M }).__searchMap;
    if (!map) return null;
    // Symbol queries read the last frame's placement: render a fresh frame first.
    await Promise.race([
      new Promise<void>((resolve) => {
        map.once("idle", resolve);
        map.triggerRepaint();
      }),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    const layers = ids.filter((id) => map.getLayer(id));
    const complete = layers.length === ids.length;
    const bg = map.getLayer("background")
      ? String(map.getPaintProperty("background", "background-color")).replace(/\s/g, "")
      : "";
    return {
      style: map.isStyleLoaded(),
      base: bg === "rgb(12,12,12)" ? "dark" : bg === "rgb(242,243,240)" ? "light" : "other",
      layers,
      rendered: complete
        ? map.queryRenderedFeatures({ layers: ["clusters", "pin-dots", "pins"] }).length
        : 0,
      pins: complete ? map.queryRenderedFeatures({ layers: ["pins"] }).length : 0,
    };
  }, OVERLAY_LAYERS);

/** The `base` style is applied and loaded, every overlay layer is there and something is drawn. */
const mapReady = async (page: Page, base: Base) => {
  const p = await probeSearchMap(page);
  return (
    !!p && p.style && p.base === base && p.layers.length === OVERLAY_LAYERS.length && p.rendered > 0
  );
};

/** Price pills drawn on the `pins` layer of the `base` style (0 while it is swapping). */
const pinsDrawn = async (page: Page, base: Base) => {
  const p = await probeSearchMap(page);
  return p && p.style && p.base === base && p.layers.length === OVERLAY_LAYERS.length ? p.pins : 0;
};

/** Zooms past the cluster limit onto the biggest cluster, so individual pins are drawn. */
async function zoomToPins(page: Page) {
  await page.evaluate(async () => {
    type F = { geometry: { coordinates: [number, number] }; properties: { point_count: number } };
    type M = {
      queryRenderedFeatures(o: { layers: string[] }): F[];
      jumpTo(o: { center: [number, number]; zoom: number }): void;
      once(e: string, cb: () => void): void;
    };
    const map = (window as unknown as { __searchMap: M }).__searchMap;
    const [biggest] = map
      .queryRenderedFeatures({ layers: ["clusters"] })
      .sort((a, b) => b.properties.point_count - a.properties.point_count);
    const idle = new Promise<void>((resolve) => map.once("idle", resolve));
    map.jumpTo({ center: biggest.geometry.coordinates, zoom: 13 });
    await idle;
  });
}

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
  await expect.poll(() => mapReady(page, "light"), { timeout: 20_000 }).toBe(true);
  expect(styles.some((u) => /styles\/positron/.test(u))).toBe(true);
  expect(styles.filter((u) => /styles\/dark/.test(u))).toEqual([]);
  await zoomToPins(page);
  await expect.poll(() => pinsDrawn(page, "light"), { timeout: 20_000 }).toBeGreaterThan(0);

  await openAppearanceMenu(page);
  const dark = page.waitForRequest(/styles\/dark/);
  await page.getByRole("radio", { name: "Dark" }).check();
  await dark;
  await expect.poll(() => mapReady(page, "dark"), { timeout: 20_000 }).toBe(true);
  // Price pills are drawn on the new style (queryRenderedFeatures on the pins layer).
  await expect.poll(() => pinsDrawn(page, "dark"), { timeout: 20_000 }).toBeGreaterThan(0);
  // The same map, restyled: not a second canvas.
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);

  const light = page.waitForRequest(/styles\/positron/);
  await page.getByRole("radio", { name: "Light" }).check();
  await light;
  await expect.poll(() => mapReady(page, "light"), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => pinsDrawn(page, "light"), { timeout: 20_000 }).toBeGreaterThan(0);
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
  await expect.poll(() => mapReady(page, "dark"), { timeout: 20_000 }).toBe(true);
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

/* ───────────────────────── DM5: the dark axe matrix ───────────────────────── */

darkAxeSuite(test, { pages: DARK_AXE_PAGES, systemPages: SYSTEM_DARK_PAGES });
