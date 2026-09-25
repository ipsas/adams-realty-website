import "dotenv/config";
import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type CDPSession,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { Client } from "pg";
import { AXE_ALLOWLIST, type AxeAllowEntry } from "./axe-allowlist";

export { signIn, PASSWORD } from "../helpers";
export { expect };

/*
 * Shared helpers for e2e/mobile/*.spec.ts. Lead-owned (docs/mobile-spec/foundation.md).
 * Import `test` from here, not from @playwright/test: its `page` fixture guarantees that
 * touch projects report `(pointer: coarse)`.
 */

type Point = { x: number; y: number };

/* ───────────────────────── fixtures ───────────────────────── */

/**
 * Makes sure a touch project's page matches `(pointer: coarse)`. Chromium normally reports it
 * for `hasTouch` contexts; if it doesn't, enable touch emulation over CDP. The session stays
 * attached for the page's lifetime because CDP emulation overrides end with their session.
 */
async function ensureCoarsePointer(page: Page): Promise<CDPSession | null> {
  const coarse = () => page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  if (await coarse()) return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (!(await coarse())) throw new Error("Touch emulation did not make (pointer: coarse) match");
  return cdp;
}

export const test = base.extend({
  page: async ({ page, hasTouch }, provide) => {
    const cdp = hasTouch ? await ensureCoarsePointer(page) : null;
    await provide(page);
    await cdp?.detach().catch(() => {});
  },
});

/* ───────────────────────── navigation ───────────────────────── */

/** Resolves once React has hydrated `selector` (its props are attached to the DOM node). */
export async function waitForHydration(page: Page, selector = "body"): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}

/** page.goto, then wait until `readySelector` is hydrated and fonts have loaded. */
export async function gotoHydrated(page: Page, url: string, readySelector: string) {
  const res = await page.goto(url);
  await waitForHydration(page, readySelector);
  await page.evaluate(() => document.fonts.ready);
  return res;
}

export async function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length);
}

/** A document load or an RSC (client navigation) request. Prefetches are not navigations. */
function isDocOrRsc(r: Request): boolean {
  const h = r.headers();
  if (h["next-router-prefetch"]) return false;
  return r.resourceType() === "document" || h["rsc"] === "1" || /[?&]_rsc=/.test(r.url());
}

/**
 * Runs `fn` and fails if it (or anything within `settleMs` after it) loads a document or
 * makes an RSC request, i.e. if it navigated or asked the server for a new route.
 */
export async function expectNoDocOrRscRequest(
  page: Page,
  fn: () => Promise<unknown>,
  { settleMs = 600 }: { settleMs?: number } = {},
): Promise<void> {
  const seen: string[] = [];
  const onRequest = (r: Request) => {
    if (isDocOrRsc(r)) seen.push(`${r.method()} ${r.url()}`);
  };
  page.on("request", onRequest);
  try {
    await fn();
    await page.waitForTimeout(settleMs);
  } finally {
    page.off("request", onRequest);
  }
  expect(seen, "document or RSC requests").toEqual([]);
}

/* ───────────────────────── layout checks ───────────────────────── */

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "page is wider than the viewport").toBeLessThanOrEqual(clientWidth);
}

const TEXT_CONTROLS =
  'input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=file],[type=color],[type=image],[type=hidden]), select, textarea, [contenteditable=""], [contenteditable=true]';

/**
 * Every visible text control is at least 16px (iOS zooms into smaller ones on focus).
 * For coarse-pointer projects. Returns how many controls were checked.
 */
export async function expectControlsAtLeast16px(page: Page, within = "body"): Promise<number> {
  const controls = await page.evaluate(
    ([root, sel]) =>
      [...document.querySelectorAll(`${root} :is(${sel})`)]
        .filter((el) => (el as HTMLElement).getClientRects().length > 0)
        .map((el) => ({
          id: el.id || el.getAttribute("name") || el.tagName.toLowerCase(),
          size: parseFloat(getComputedStyle(el).fontSize),
        })),
    [within, TEXT_CONTROLS] as const,
  );
  expect(
    controls.filter((c) => c.size < 16),
    "text controls under 16px",
  ).toEqual([]);
  return controls.length;
}

/**
 * Every visible element matching `selector` is at least `min` × `min` CSS px, except those
 * matching one of the `allowlist` selectors. Returns how many elements were checked.
 */
export async function expectTapTargets(
  page: Page,
  selector: string,
  min = 44,
  allowlist: string[] = [],
): Promise<number> {
  const targets = await page.evaluate(
    ([sel, skip]) =>
      [...document.querySelectorAll(sel)]
        .filter((el) => (el as HTMLElement).getClientRects().length > 0)
        .filter((el) => !skip.some((s) => el.matches(s)))
        .map((el) => {
          const r = el.getBoundingClientRect();
          const name =
            el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName;
          return {
            name,
            width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10,
          };
        }),
    [selector, allowlist] as const,
  );
  expect(
    targets.filter((t) => t.width < min || t.height < min),
    `tap targets under ${min}px`,
  ).toEqual([]);
  return targets.length;
}

/* ───────────────────────── touch input (CDP) ───────────────────────── */

async function withCdp<T>(page: Page, fn: (cdp: CDPSession) => Promise<T>): Promise<T> {
  const cdp = await page.context().newCDPSession(page);
  try {
    return await fn(cdp);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function centerOf(target: Locator | Point): Promise<Point> {
  if ("x" in target) return target;
  const box = await target.boundingBox();
  if (!box) throw new Error("touch target is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real touch tap (touchstart/touchend, then the synthesized pointer and click events). */
export async function touchTap(page: Page, target: Locator | Point): Promise<void> {
  const { x, y } = await centerOf(target);
  await withCdp(page, async (cdp) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
}

/** One finger from `from` to `to` in `steps` moves, `stepMs` apart. */
export async function touchDrag(
  page: Page,
  from: Locator | Point,
  to: Point | { dx: number; dy: number },
  { steps = 10, stepMs = 16 }: { steps?: number; stepMs?: number } = {},
): Promise<void> {
  const start = await centerOf(from);
  const end = "dx" in to ? { x: start.x + to.dx, y: start.y + to.dy } : to;
  await withCdp(page, async (cdp) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.waitForTimeout(stepMs);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
}

/** Two fingers around `center`, moving from `fromDistance` to `toDistance` px apart. */
export async function pinch(
  page: Page,
  center: Locator | Point,
  fromDistance: number,
  toDistance: number,
  { steps = 10, stepMs = 16 }: { steps?: number; stepMs?: number } = {},
): Promise<void> {
  const c = await centerOf(center);
  const points = (d: number) => [
    { x: c.x - d / 2, y: c.y, id: 0 },
    { x: c.x + d / 2, y: c.y, id: 1 },
  ];
  await withCdp(page, async (cdp) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(fromDistance),
    });
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(stepMs);
      const d = fromDistance + ((toDistance - fromDistance) * i) / steps;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(d) });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
}

/**
 * Counts taps for head-to-head flows: tap through `taps.tap(locator)` or `taps.at(point)`
 * and compare `taps.count` against the budget.
 */
export function countTaps(page: Page) {
  let count = 0;
  return {
    get count() {
      return count;
    },
    async tap(target: Locator) {
      await target.tap();
      count++;
    },
    async at(point: Point) {
      await touchTap(page, point);
      count++;
    },
    reset() {
      count = 0;
    },
  };
}

/* ───────────────────────── environment simulation ───────────────────────── */

/** Pretends the device has safe-area insets by overriding the --sai-* variables (px). */
export async function simulateNotch(
  page: Page,
  {
    top = 0,
    right = 0,
    bottom = 0,
    left = 0,
  }: Partial<Record<"top" | "right" | "bottom" | "left", number>>,
): Promise<void> {
  await page.evaluate(
    (insets) => {
      const s = document.documentElement.style;
      for (const [side, px] of Object.entries(insets)) s.setProperty(`--sai-${side}`, `${px}px`);
    },
    { top, right, bottom, left },
  );
}

/**
 * Pretends an on-screen keyboard covers `fraction` of the layout viewport: stubs
 * visualViewport.height/offsetTop and dispatches resize. `fraction` 0 removes the stub.
 * Returns the simulated keyboard height in px.
 */
export async function simulateKeyboard(page: Page, fraction: number): Promise<number> {
  return page.evaluate((f) => {
    const vv = window.visualViewport;
    if (!vv) throw new Error("visualViewport is not supported");
    const own = vv as unknown as Record<string, unknown>;
    delete own.height;
    delete own.offsetTop;
    let keyboard = 0;
    if (f > 0) {
      keyboard = Math.round(window.innerHeight * f);
      const height = window.innerHeight - keyboard;
      Object.defineProperty(vv, "height", { configurable: true, get: () => height });
      Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => 0 });
    }
    vv.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    return keyboard;
  }, fraction);
}

/* ───────────────────────── database ───────────────────────── */

/** Test-only setup/teardown (removed_at, last_synced_at, …) on the app's database. */
export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://adams:adams@localhost:5432/adams_realty",
  });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/* ───────────────────────── accessibility ───────────────────────── */

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export type AxeFinding = {
  rule: string;
  impact: string;
  target: string;
  allowedBy?: AxeAllowEntry;
};

/**
 * Runs axe and fails on any color-contrast violation (at any impact) and on any other
 * serious or critical violation not covered by an axe-allowlist.ts entry (rule + selector).
 * Returns every finding, allowlisted ones included, for callers that assert more.
 */
export async function expectNoSeriousAxe(
  page: Page,
  { allowlist = AXE_ALLOWLIST }: { allowlist?: readonly AxeAllowEntry[] } = {},
): Promise<AxeFinding[]> {
  const contrastEntries = allowlist.filter((e) => e.rule === "color-contrast");
  expect(contrastEntries, "color-contrast can never be allowlisted").toEqual([]);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const findings: AxeFinding[] = [];
  for (const v of results.violations) {
    const relevant = v.id === "color-contrast" || v.impact === "serious" || v.impact === "critical";
    if (!relevant) continue;
    const entries = allowlist.filter((e) => e.rule === v.id);
    for (const node of v.nodes) {
      const target = node.target.map(String).join(" ");
      let allowedBy: AxeAllowEntry | undefined;
      if (entries.length && node.target.length === 1) {
        const matched = await page.evaluate(
          ([sel, candidates]) => {
            const el = document.querySelector(sel);
            return el ? candidates.findIndex((c) => el.closest(c) !== null) : -1;
          },
          [String(node.target[0]), entries.map((e) => e.selector)] as const,
        );
        if (matched !== -1) allowedBy = entries[matched];
      }
      findings.push({ rule: v.id, impact: v.impact ?? "unknown", target, allowedBy });
    }
  }
  const blocking = findings
    .filter((f) => !f.allowedBy)
    .map(({ rule, impact, target }) => `${rule} (${impact}): ${target}`);
  expect(blocking, `axe violations on ${page.url()}`).toEqual([]);
  return findings;
}
