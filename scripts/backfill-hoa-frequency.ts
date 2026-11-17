/**
 * One-time, idempotent backfill of the HOA fee period of Georgia MLS listings:
 *
 *   DATABASE_URL=... npm run backfill:hoa-frequency                     # dry run
 *   DATABASE_URL=... npm run backfill:hoa-frequency -- --apply --expect=<N>
 *
 * Sets hoa_frequency = 'annually' (GAMLS_FEE_FREQUENCY) on every Georgia MLS listing
 * with a fee and no stored period (`backfillWhere` in src/lib/listings/fee-backfill.ts),
 * removed ones included, and nothing else (not updated_at). A direct UPDATE rather than
 * forcing a remap: the gamls2 feed sends no AssociationFeeFrequency and GAMLS defines
 * AssociationFee as the "Annual Association Fee", so the mapper resolves every Georgia
 * MLS fee to exactly this value; a forced remap re-reads ~67k records and still can't
 * reach soft-removed rows (not in the feed) or rows the walk misses.
 *
 * The default is a dry run (a read-only transaction, rolled back): the matching count,
 * by removed/live and status. `--apply --expect=<N>` (N: the dry run's count) writes in
 * one transaction, and rolls back (exit 1) unless the recount and the UPDATE's row
 * count are both N. A second run matches 0 rows. DATABASE_URL comes from the
 * environment only.
 */
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { dataSources, listings } from "@/db/schema";
import { BACKFILL_SET, backfillUpdate, backfillWhere } from "@/lib/listings/fee-backfill";
import { GAMLS_SLUG } from "@/lib/mls/gamls";

function parseArgs(argv: string[]): { apply: boolean; expect: number | null } | string {
  let apply = false;
  let expect: number | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--expect=")) {
      const n = Number(arg.slice("--expect=".length));
      if (!Number.isInteger(n) || n < 0) return `Bad ${arg}: expected a whole number.`;
      expect = n;
    } else return `Unknown argument ${arg}.`;
  }
  if (apply && expect === null) return "--apply needs --expect=<the dry run's count>.";
  return { apply, expect };
}

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
    const db = drizzle(client);
    await client.query(args.apply ? "begin" : "begin transaction read only");
    const sources = await db
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(eq(dataSources.slug, GAMLS_SLUG));
    if (!sources.length) {
      await client.query("rollback");
      console.error(`No data source with slug ${GAMLS_SLUG}.`);
      return 1;
    }
    const where = backfillWhere(sources.map((s) => s.id));
    const matching = async () => (await db.select({ n: count() }).from(listings).where(where))[0].n;

    if (!args.apply) {
      const removed = sql<boolean>`${listings.removedAt} is not null`;
      const rows = await db
        .select({
          removed,
          status: listings.status,
          n: count(),
        })
        .from(listings)
        .where(where)
        .groupBy(removed, listings.status)
        .orderBy(removed, listings.status);
      await client.query("rollback");
      const total = rows.reduce((a, r) => a + r.n, 0);
      console.info(`Georgia MLS listings with an HOA fee and no period: ${total}`);
      for (const r of rows)
        console.info(
          `  ${(r.removed ? "removed" : "live").padEnd(8)} ${r.status.padEnd(16)} ${r.n}`,
        );
      console.info("dry run: nothing written");
      if (total)
        console.info(`To write: npm run backfill:hoa-frequency -- --apply --expect=${total}`);
      return 0;
    }

    const before = await matching();
    if (before !== args.expect) {
      await client.query("rollback");
      console.error(`Expected ${args.expect} matching rows, found ${before}: nothing written.`);
      return 1;
    }
    const updated = await db.execute(backfillUpdate(sources.map((s) => s.id)));
    if (updated.rowCount !== args.expect) {
      await client.query("rollback");
      console.error(
        `The UPDATE touched ${updated.rowCount} rows, not ${args.expect}: rolled back.`,
      );
      return 1;
    }
    await client.query("commit");
    const remaining = await matching();
    console.info(`Set hoa_frequency = '${BACKFILL_SET.hoaFrequency}' on ${updated.rowCount} rows.`);
    console.info(`Still matching: ${remaining}`);
    return remaining === 0 ? 0 : 1;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
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
