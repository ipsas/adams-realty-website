/**
 * Runs an MLS sync from the command line.
 *
 *   npm run mls:sync                 # incremental sync of all active feeds
 *   npm run mls:sync -- --full       # ignore cursors, re-fetch everything
 *   npm run mls:sync -- --purge      # also remove listings that left the feed
 */
import "dotenv/config";
import { syncAllSources } from "@/lib/mls/sync";

const full = process.argv.includes("--full");
const purge = process.argv.includes("--purge");

syncAllSources({ full, purge })
  .then((results) => {
    if (!results.length)
      console.info("No active RESO Web API sources. Add one in the data_sources table.");
    for (const r of results) console.info(r.source, r.ok ? r.result : `FAILED: ${r.error}`);
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
