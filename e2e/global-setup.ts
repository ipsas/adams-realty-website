import type { FullConfig } from "@playwright/test";
import cleanUpTestLeads from "./global-cleanup";

/**
 * Before a run: sweep test leads a stopped run left behind, and have `next dev` compile
 * the form-token route once, so the first form a test sends isn't timed from a token that
 * arrived seconds late (src/lib/form-token.ts).
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  await cleanUpTestLeads();
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  try {
    await fetch(new URL("/api/form-token", baseURL), { cache: "no-store" });
  } catch {
    // The web server starts after global setup when Playwright launches it; nothing to warm.
  }
}
