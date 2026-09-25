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
