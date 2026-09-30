import { defineConfig, devices } from "@playwright/test";
import { FIXTURE_PHOTO_HOST } from "./src/config/images";

/**
 * End-to-end tests against a seeded database (`npm run db:reset`).
 * Starts `next dev` unless a server is already running at the base URL.
 *
 * Projects:
 * - desktop: every suite except e2e/mobile/.
 * - mobile: the public suite on a Pixel 7 (unchanged).
 * - pixel7, iphone13: every e2e/mobile/*.spec.ts.
 * - iphone13-landscape, ipad-mini: e2e/mobile/sweep.spec.ts and *landscape*.spec.ts, plus any
 *   mobile test tagged @landscape.
 * Chromium only; the iPhone/iPad projects emulate WebKit devices in Chromium.
 */
const PORT = process.env.PORT ?? "3000";
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

const MOBILE_SPECS = /mobile\/.*\.spec\.ts/;
// The grep title starts with the spec's path relative to e2e/ (backslashes on Windows).
const LANDSCAPE_GREP = [
  /(^|\s)mobile[\\/](sweep|[^\\/\s]*landscape[^\\/\s]*)\.spec\.ts(\s|$)/,
  /@landscape/,
];

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\// },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /public\.spec\.ts/ },
    { name: "pixel7", use: { ...devices["Pixel 7"] }, testMatch: MOBILE_SPECS },
    {
      name: "iphone13",
      use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" },
      testMatch: MOBILE_SPECS,
    },
    {
      name: "iphone13-landscape",
      use: {
        browserName: "chromium",
        defaultBrowserType: "chromium",
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        userAgent: IPHONE_UA,
      },
      testMatch: MOBILE_SPECS,
      grep: LANDSCAPE_GREP,
    },
    {
      name: "ipad-mini",
      use: {
        browserName: "chromium",
        defaultBrowserType: "chromium",
        viewport: { width: 744, height: 1133 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        userAgent: IPAD_UA,
      },
      testMatch: MOBILE_SPECS,
      grep: LANDSCAPE_GREP,
    },
  ],
  webServer: [
    {
      command: `npx next dev -p ${PORT}`,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // The fake MLS photo host (full-size originals) for e2e/photos-suite.ts.
      command: "node e2e/fixtures/photo-host.mjs",
      url: `${FIXTURE_PHOTO_HOST}/`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
