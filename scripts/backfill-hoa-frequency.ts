/**
 * One-time, idempotent backfill of the HOA fee period of Georgia MLS listings:
 *
 *   DATABASE_URL=... npm run backfill:hoa-frequency                     # dry run
 *   DATABASE_URL=... npm run backfill:hoa-frequency -- --apply --expect=<N>
 *
 * Sets hoa_frequency = 'annually' (GAMLS_FEE_FREQUENCY) on every Georgia MLS feed listing
 * (from_feed true; dashboard-entered rows are out) with a fee and no stored period
 * (`backfillWhere` in src/lib/listings/fee-backfill.ts, check:fees' scope), removed ones
 * included, and nothing else (not updated_at). A direct UPDATE rather than
 * forcing a remap: the gamls2 feed sends no AssociationFeeFrequency and GAMLS defines
 * AssociationFee as the "Annual Association Fee", so the mapper resolves every Georgia
 * MLS fee to exactly this value; a forced remap re-reads ~67k records and still can't
 * reach soft-removed rows (not in the feed) or rows the walk misses.
 *
 * The default is a dry run (a read-only transaction, rolled back): the matching count,
 * by removed/live and status. `--apply --expect=<N>` (N: the dry run's count) writes in
 * one transaction, and rolls back (exit 1) unless the recount and the UPDATE's row
 * count are both N. A second run matches 0 rows. DATABASE_URL comes from the
 * environment only. The logic is `runBackfill` in src/lib/listings/fee-backfill-run.ts.
 */
import { Client } from "pg";
import { parseArgs, runBackfill } from "@/lib/listings/fee-backfill-run";

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(args);
    return 1;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    return 1;
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await runBackfill(client, args);
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
