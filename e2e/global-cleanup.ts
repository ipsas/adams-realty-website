import { withDb } from "./mobile/helpers";

/*
 * Test leads never stay in the shared database, where they would crowd the broker's
 * "Needs attention" box and latest leads (site review, fix round 1). Each test that sends a
 * lead through a form removes it itself; this sweeps up after a run that stopped midway,
 * before and after every run. It only matches the throwaway addresses tests make up
 * (`e2e-…@example.com`, the spam suite's `hp-<time>@example.com` and so on) and the two
 * fixed addresses older runs used; the seed's sample leads never match.
 */
export const E2E_LEAD_EMAILS = String.raw`^(e2e-[a-z0-9-]+|(hp|fast|pitch|person|limited)-[0-9]+)@example\.com$`;
const LEGACY = ["e2e@example.com", "sam.tester@example.com"];

export default async function cleanUpTestLeads(): Promise<void> {
  try {
    await withDb((db) =>
      db.query("delete from inquiries where email ~ $1 or email = any($2::text[])", [
        E2E_LEAD_EMAILS,
        LEGACY,
      ]),
    );
  } catch (e) {
    // No database (a run against a remote server): nothing to clean here.
    console.warn("[e2e] couldn't clean up test leads", e);
  }
}
