/**
 * Runs an MLS sync from the command line. No time budget here (a Vercel
 * function has 300 s; a workstation or CI job doesn't), so this is how the
 * first statewide load (~65k listings, 20–60 minutes) is done.
 *
 *   npm run mls:sync                                  # incremental sync of all active feeds
 *   npm run mls:sync -- --full                        # ignore cursors, re-fetch everything
 *   npm run mls:sync -- --purge                       # only remove listings that left the feed
 *   npm run mls:sync -- --purge --allow-large-purge   # …even past the 5% removal cap
 *   npm run mls:sync -- --minutes 4                   # stop between pages after ~4 minutes
 *
 * The running site's caches can't be revalidated from here; they refresh
 * within 15 minutes (LISTINGS_CACHE_SECONDS). Autocomplete places are rebuilt.
 */
import "dotenv/config";
import { syncAllSources, type SyncMode } from "@/lib/mls/sync";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
if (has("--full") && has("--purge")) {
  console.error("--full and --purge are separate runs: run one, then the other.");
  process.exit(2);
}
const mode: SyncMode = has("--purge") ? "purge" : has("--full") ? "full" : "incremental";
const minutesArg = args[args.indexOf("--minutes") + 1];
const minutes = has("--minutes") ? Number(minutesArg) : undefined;
if (minutes !== undefined && !(minutes > 0)) {
  console.error(`--minutes needs a positive number, got "${minutesArg}"`);
  process.exit(2);
}

syncAllSources({
  mode,
  allowLargePurge: has("--allow-large-purge"),
  deadline: minutes ? Date.now() + minutes * 60_000 : undefined,
})
  .then((results) => {
    if (!results.length)
      console.info("No active RESO Web API sources. Add one in the data_sources table.");
    for (const r of results) console.info(r.source, r.ok ? r.result : `FAILED: ${r.error}`);
    if (results.some((r) => r.ok && r.result.status === "partial")) {
      console.info("Stopped at the time limit; run again to continue from the saved cursor.");
    }
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
