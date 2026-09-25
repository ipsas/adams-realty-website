import type { Page } from "@playwright/test";
import { AXE_ALLOWLIST } from "./axe-allowlist";
import {
  expect,
  expectControlsAtLeast16px,
  expectNoDocOrRscRequest,
  expectNoHorizontalOverflow,
  expectNoSeriousAxe,
  expectTapTargets,
  gotoHydrated,
  historyLength,
  signIn,
  simulateKeyboard,
  test,
  touchTap,
} from "./helpers";

/*
 * Foundation exit criteria (docs/mobile-spec/foundation.md). Runs on pixel7 and iphone13;
 * tests tagged @landscape also run on iphone13-landscape and ipad-mini.
 * Criterion 1 is the full suite itself; criterion 6 (desktop screenshots) lives elsewhere.
 */

const PRIMITIVES = "/dev/primitives";

async function openPrimitives(page: Page) {
  await gotoHydrated(page, PRIMITIVES, '[data-testid="open-sheet"]');
}

/* ───────────────────────── harness ───────────────────────── */

test.describe("harness", () => {
  test(
    "touch projects report a coarse pointer and get touch-sized controls",
    { tag: "@landscape" },
    async ({ page }, testInfo) => {
      expect(testInfo.project.use.hasTouch, "mobile projects must emulate touch").toBe(true);
      await openPrimitives(page);
      expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);

      // form.tsx: text controls are 16px on coarse pointers (no iOS focus zoom).
      expect(await expectControlsAtLeast16px(page)).toBeGreaterThanOrEqual(3);
      // button.tsx: sm/md/icon grow to 44px on coarse pointers.
      const buttons = page.getByRole("button", { name: /^(Small|Medium|Alerts)$/ });
      await expect(buttons).toHaveCount(3);
      for (const b of await buttons.all()) {
        const box = await b.boundingBox();
        expect(box?.height, await b.innerText()).toBeGreaterThanOrEqual(44);
      }
      await expectNoHorizontalOverflow(page);
    },
  );

  test("the axe allowlist has an owner and a reason for every entry, and no contrast entries", () => {
    expect(AXE_ALLOWLIST.filter((e) => e.rule === "color-contrast")).toEqual([]);
    for (const e of AXE_ALLOWLIST) {
      expect(e.rule, JSON.stringify(e)).toMatch(/^[a-z-]+$/);
      expect(e.selector.trim(), JSON.stringify(e)).not.toBe("");
      expect(e.owner, JSON.stringify(e)).toMatch(/^WP[1-6]$/);
      expect(e.reason.trim().length, JSON.stringify(e)).toBeGreaterThan(10);
    }
  });
});

/* ───────────────────────── criterion 2: /dev/primitives ───────────────────────── */

test.describe("criterion 2: primitives", () => {
  test("Back with the closeOnBack sheet open closes it, keeps the URL, no RSC request", async ({
    page,
  }) => {
    await openPrimitives(page);
    const url = page.url();
    const before = await historyLength(page);

    await page.getByTestId("open-sheet").click();
    const sheet = page.getByRole("dialog", { name: "Sheet", exact: true });
    await expect(sheet).toBeVisible();
    expect(await historyLength(page), "opening pushes one entry").toBe(before + 1);

    await expectNoDocOrRscRequest(page, async () => {
      await page.goBack();
      await expect(sheet).toBeHidden();
    });
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => document.querySelectorAll("dialog[open]").length)).toBe(0);
  });

  test("navigateFromDialog, then one Back, returns to /dev/primitives; history grows by 1", async ({
    page,
  }) => {
    await openPrimitives(page);
    const start = page.url();
    const before = await historyLength(page);

    await page.getByTestId("open-fullscreen").click();
    const dialog = page.getByRole("dialog", { name: "Full screen", exact: true });
    await expect(dialog).toBeVisible();

    await page.getByTestId("dialog-nav-link").click();
    await expect(page).toHaveURL(/\/dev\/primitives\?navigated=1$/);
    await expect(page.getByTestId("navigated-banner")).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await historyLength(page)).toBe(before + 1);

    await page.goBack();
    await expect(page).toHaveURL(start);
    await expect(page.getByTestId("navigated-banner")).toHaveCount(0);
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.querySelectorAll("dialog[open]").length)).toBe(0);
  });

  test("a toast action inside an open dialog is clickable and fires", async ({ page }) => {
    await openPrimitives(page);
    await page.getByTestId("open-toast-dialog").click();
    const dialog = page.getByRole("dialog", { name: "Toast inside a dialog", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("undo-count")).toHaveText("Undo clicked: 0");

    await dialog.getByTestId("dialog-toast-button").click();
    // The toast renders inside the dialog (anything outside a modal dialog is inert).
    const toast = dialog.locator("[data-toast-slot] [data-toast]");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Removed from saved");

    // tap() hit-tests the point first, so an inert or covered button fails here.
    await toast.getByRole("button", { name: "Undo" }).tap();
    await expect(dialog.getByTestId("undo-count")).toHaveText("Undo clicked: 1");
    await expect(page.locator("[data-toast]")).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test("with simulateKeyboard(0.55) the sheet and its focused input stay fully visible and --kb-inset > 0", async ({
    page,
  }) => {
    await openPrimitives(page);
    await page.getByTestId("open-sheet").click();
    const sheet = page.getByRole("dialog", { name: "Sheet", exact: true });
    await expect(sheet).toBeVisible();
    const input = sheet.getByTestId("sheet-input");
    await input.focus();
    await expect(input).toBeFocused();

    const keyboard = await simulateKeyboard(page, 0.55);
    expect(keyboard).toBeGreaterThan(0);

    const kbInset = () =>
      sheet.evaluate((d) => parseFloat(getComputedStyle(d).getPropertyValue("--kb-inset")) || 0);
    await expect.poll(kbInset).toBeGreaterThan(0);
    expect(Math.abs((await kbInset()) - keyboard)).toBeLessThanOrEqual(1);

    // Fully visible: inside the visual viewport left above the keyboard, and not clipped by
    // the dialog or any scroll container around the input.
    const visibility = () =>
      input.evaluate((el) => {
        const vv = window.visualViewport!;
        const r = el.getBoundingClientRect();
        let top = vv.offsetTop;
        let bottom = vv.offsetTop + vv.height;
        let left = 0;
        let right = window.innerWidth;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowY !== "visible" || a.tagName === "DIALOG") {
            const b = a.getBoundingClientRect();
            top = Math.max(top, b.top);
            bottom = Math.min(bottom, b.bottom);
          }
          if (s.overflowX !== "visible" || a.tagName === "DIALOG") {
            const b = a.getBoundingClientRect();
            left = Math.max(left, b.left);
            right = Math.min(right, b.right);
          }
          if (a.tagName === "DIALOG") break;
        }
        const eps = 0.5;
        return {
          fullyVisible:
            r.height > 0 &&
            r.top >= top - eps &&
            r.bottom <= bottom + eps &&
            r.left >= left - eps &&
            r.right <= right + eps,
          input: [r.top, r.bottom, r.left, r.right].map(Math.round),
          visible: [top, bottom, left, right].map(Math.round),
        };
      });
    await expect.poll(visibility).toMatchObject({ fullyVisible: true });

    // The sheet itself fits above the keyboard: its top edge and its Close button are inside
    // the visual viewport, so a max-height that ignores --kb-inset (which pushes the header
    // off the top of the screen) fails here.
    const close = sheet.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeVisible();
    const sheetFit = () =>
      sheet.evaluate((el) => {
        const vv = window.visualViewport!;
        const d = el.getBoundingClientRect();
        const c = el.querySelector('button[aria-label="Close"]')!.getBoundingClientRect();
        const top = vv.offsetTop - 0.5;
        const bottom = vv.offsetTop + vv.height + 0.5;
        return {
          sheetInView: d.top >= top && d.bottom <= bottom,
          closeInView: c.height > 0 && c.top >= top && c.bottom <= bottom,
          sheet: [d.top, d.bottom].map(Math.round),
          close: [c.top, c.bottom].map(Math.round),
          viewport: [top, bottom].map(Math.round),
        };
      });
    await expect.poll(sheetFit).toMatchObject({ sheetInView: true, closeInView: true });
    await expect(input).toBeFocused();
  });

  test("a tap on the popover scrim closes it and does not navigate", async ({ page }) => {
    await openPrimitives(page);
    const trigger = page.getByTestId("popover").getByRole("button", { name: "Open popover" });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const scrim = page.locator("[data-popover-scrim]");
    await expect(scrim).toBeVisible();

    // Tap where the link lies under the scrim.
    const box = (await page.getByTestId("scrim-target").boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return {
        scrim: !!el?.hasAttribute("data-popover-scrim"),
        overLink: document
          .elementsFromPoint(x, y)
          .some((e) => e.getAttribute("data-testid") === "scrim-target"),
      };
    }, point);
    expect(hit).toEqual({ scrim: true, overLink: true });

    const url = page.url();
    await expectNoDocOrRscRequest(
      page,
      async () => {
        await touchTap(page, point);
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
      },
      { settleMs: 1200 },
    );
    expect(page.url()).toBe(url);
    await expect(scrim).toHaveCount(0);
  });

  test("SaveButton plain and overlay are at least 44x44 on coarse pointers", async ({ page }) => {
    await openPrimitives(page);
    const checked = await expectTapTargets(
      page,
      '[data-testid="save-plain"] button, [data-testid="save-overlay"] button',
      44,
    );
    expect(checked).toBe(2);
  });
});

/* ───────────────────────── criterion 3: meta viewport ───────────────────────── */

test("criterion 3: the meta viewport has viewport-fit=cover and interactive-widget=resizes-content", async ({
  page,
}) => {
  await page.goto("/");
  const meta = page.locator('meta[name="viewport"]');
  await expect(meta).toHaveCount(1);
  const content = (await meta.getAttribute("content")) ?? "";
  const parts = content.split(",").map((p) => p.trim().replace(/\s*=\s*/, "="));
  expect(parts).toContain("viewport-fit=cover");
  expect(parts).toContain("interactive-widget=resizes-content");
});

/* ───────────────────────── criterion 4: axe ───────────────────────── */

test.describe("criterion 4: no contrast violations, other serious findings allowlisted", () => {
  async function firstListingPath(page: Page): Promise<string> {
    await page.goto("/homes");
    const href = await page.locator("article a[href^='/homes/']").first().getAttribute("href");
    expect(href).toMatch(/^\/homes\/[a-z0-9-]+$/);
    return href!;
  }

  const pages: { name: string; path: (page: Page) => Promise<string>; ready: string }[] = [
    { name: "/", path: async () => "/", ready: "main h1" },
    { name: "/homes", path: async () => "/homes", ready: "[aria-live=polite]" },
    { name: "a listing", path: firstListingPath, ready: "main p.tabular" },
    { name: "/sign-in", path: async () => "/sign-in", ready: "#email" },
  ];

  for (const p of pages) {
    test(p.name, async ({ page }) => {
      const path = await p.path(page);
      await gotoHydrated(page, path, p.ready);
      await expect(page.locator(p.ready).first()).toBeVisible();
      await expectNoSeriousAxe(page);
    });
  }
});

/* ───────────────────────── criterion 5: chrome on every route ───────────────────────── */

test.describe("criterion 5: header and tab bar render on every route", () => {
  test.describe.configure({ timeout: 180_000 });

  /**
   * The header is in the DOM (and visible unless the page owns its top chrome), and the root
   * layout rendered through <TabBar> (a foundation stub that returns null): the layout-level
   * Toaster region, mounted right after it, follows #main. A tab bar, once WP2 renders one,
   * must be that single layout-level element.
   */
  async function expectChrome(page: Page, path: string, status = 200) {
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    page.on("pageerror", onError);
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(status);
    const header = page.locator("[data-site-header]");
    await expect(header, path).toHaveCount(1);
    if ((await page.locator('[data-own-chrome~="top"]').count()) === 0) {
      await expect(header, path).toBeVisible();
    }
    await expect(page.locator("#main"), path).toHaveCount(1);
    await expect(page.locator('#main ~ [role="status"]'), path).toHaveCount(1);
    const tabbars = await page.locator("[data-tabbar]").count();
    expect(tabbars, path).toBeLessThanOrEqual(1);
    await expect(page.locator("#main ~ [data-tabbar]"), path).toHaveCount(tabbars);
    await page.waitForLoadState("load");
    page.off("pageerror", onError);
    expect(errors, `${path} page errors`).toEqual([]);
  }

  test("signed-out routes, including the 404", async ({ page }) => {
    await page.goto("/homes");
    const listing = await page.locator("article a[href^='/homes/']").first().getAttribute("href");
    await page.goto("/agents");
    const agent = await page.locator("main a[href^='/agents/']").first().getAttribute("href");
    expect(listing).toMatch(/^\/homes\/[a-z0-9-]+$/);
    expect(agent).toMatch(/^\/agents\/[a-z0-9-]+$/);

    for (const path of [
      "/",
      "/homes",
      listing!,
      "/sell",
      "/about",
      "/accessibility",
      "/agents",
      agent!,
      "/areas",
      "/areas/royston",
      "/contact",
      "/fair-housing",
      "/privacy",
      "/terms",
      "/alerts/unsubscribe",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/reset-password",
      PRIMITIVES,
    ]) {
      await expectChrome(page, path);
    }
    await expectChrome(page, "/homes/does-not-exist", 404);
  });

  test("buyer routes", async ({ page }) => {
    await signIn(page, "buyer@example.com", "/");
    for (const path of ["/saved", "/account"]) await expectChrome(page, path);
  });

  test("staff routes", async ({ page }) => {
    await signIn(page, "admin@adamsrealty.example", "/dashboard");
    for (const path of [
      "/dashboard",
      "/dashboard/leads",
      "/dashboard/listings",
      "/dashboard/listings/new",
      "/dashboard/agents",
      "/dashboard/users",
      "/dashboard/sources",
      "/dashboard/profile",
    ]) {
      await expectChrome(page, path);
    }
  });
});
