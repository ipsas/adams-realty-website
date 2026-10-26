/**
 * One-time purge of the preview database's listings, run by the Vercel build
 * (scripts/vercel-build.mjs) when purgeDecision allows it. It deletes only on
 * the Neon preview branch, read from the connection itself; on the production
 * branch it throws so the build fails. Deleting listings cascades to their
 * media, open houses, events, saves and views and clears inquiries.listing_id
 * (src/db/schema). Logs Neon ids and counts only, never connection details.
 */
import pg from "pg";
import { checkBranch, purgeDecision } from "../src/lib/mls/preview-purge.mjs";

export { checkBranch, purgeDecision };

/** The demo feed (scripts/seed.ts) and Georgia MLS via Bridge (src/lib/mls/gamls.ts). */
const SOURCE_SLUGS = ["demo-mls", "gamls"];

async function showSetting(client, name) {
  try {
    const { rows } = await client.query(`SHOW ${name}`);
    return Object.values(rows[0] ?? {})[0] || null;
  } catch {
    return null;
  }
}

async function counts(client) {
  const { rows } = await client.query(`select
    (select count(*)::int from listings) as listings,
    (select count(*)::int from listing_media) as listing_media,
    (select count(*)::int from open_houses) as open_houses,
    (select count(*)::int from listing_events) as listing_events,
    (select count(*)::int from saved_listings) as saved_listings,
    (select count(*)::int from inquiries where listing_id is not null) as inquiries_with_listing`);
  const sources = await client.query(
    "select slug, is_active from data_sources where slug = any($1) order by slug",
    [SOURCE_SLUGS],
  );
  return {
    ...rows[0],
    data_sources: Object.fromEntries(sources.rows.map((r) => [r.slug, r.is_active])),
  };
}

/**
 * @param {string} connectionString
 * @param {(line: string) => void} [log]
 */
export async function purgePreviewListings(connectionString, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const projectId = await showSetting(client, "neon.project_id");
    const branchId = await showSetting(client, "neon.branch_id");
    const verdict = checkBranch({ projectId, branchId });
    log(`Preview purge branch check: project=${projectId} branch=${branchId} -> ${verdict}`);
    if (verdict === "fatal") {
      throw new Error("Preview purge: connected to the production branch; refusing and failing.");
    }
    if (verdict === "refuse") {
      log("Preview purge refused: not the Neon preview project and branch; nothing deleted.");
      return;
    }
    log(`Preview purge before: ${JSON.stringify(await counts(client))}`);
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM listings");
      await client.query("UPDATE data_sources SET is_active = false WHERE slug = any($1)", [
        SOURCE_SLUGS,
      ]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    log(`Preview purge after: ${JSON.stringify(await counts(client))}`);
  } finally {
    await client.end();
  }
}
