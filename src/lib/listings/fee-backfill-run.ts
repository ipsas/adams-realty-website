import { eq, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { dataSources, listings } from "@/db/schema";
import { GAMLS_SLUG } from "@/lib/mls/gamls";
import { BACKFILL_SET, backfillUpdate, backfillWhere } from "./fee-backfill";

/**
 * The write logic of `npm run backfill:hoa-frequency` (scripts/backfill-hoa-frequency.ts,
 * a thin wrapper that connects and calls runBackfill), apart from the connection so
 * tests can drive it with a fake client that records every statement.
 */

export type BackfillArgs = { apply: boolean; expect: number | null };

/** The script's arguments, or the message to print (exit 1). */
export function parseArgs(argv: string[]): BackfillArgs | string {
  let apply = false;
  let expect: number | null = null;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--expect=")) {
      const raw = arg.slice("--expect=".length);
      const n = Number(raw);
      // Digits only: Number("") is 0, and " 5" or "1e3" aren't counts anyone typed.
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n))
        return `Bad ${arg}: expected a whole number.`;
      expect = n;
    } else return `Unknown argument ${arg}.`;
  }
  if (apply && expect === null) return "--apply needs --expect=<the dry run's count>.";
  return { apply, expect };
}

/** What runBackfill needs of a connection: pg's Client satisfies it. */
export interface BackfillClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

const dialect = new PgDialect();

/**
 * Runs the backfill on a connected client and returns the exit code. The default is a
 * dry run: a read-only transaction, rolled back, that prints the matching count by
 * removed/live and status. With `apply`, one transaction that rolls back (exit 1)
 * unless the recount and the UPDATE's row count are both `expect`, then commits.
 * Any error rolls back and is rethrown. The caller closes the client.
 */
export async function runBackfill(client: BackfillClient, args: BackfillArgs): Promise<number> {
  const run = (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    return client.query(text, params);
  };
  try {
    await client.query(args.apply ? "begin" : "begin transaction read only");
    const sources = (
      await run(
        sql`select ${dataSources.id} as id from ${dataSources} where ${eq(dataSources.slug, GAMLS_SLUG)}`,
      )
    ).rows.map((r) => String(r.id));
    if (!sources.length) {
      await client.query("rollback");
      console.error(`No data source with slug ${GAMLS_SLUG}.`);
      return 1;
    }
    const where = backfillWhere(sources);
    const matching = async () =>
      Number((await run(sql`select count(*)::int as n from ${listings} where ${where}`)).rows[0].n);

    if (!args.apply) {
      const removed = sql`${listings.removedAt} is not null`;
      const rows = (
        await run(
          sql`select ${removed} as removed, ${listings.status} as status, count(*)::int as n from ${listings} where ${where} group by ${removed}, ${listings.status} order by ${removed}, ${listings.status}`,
        )
      ).rows.map((r) => ({
        removed: Boolean(r.removed),
        status: String(r.status),
        n: Number(r.n),
      }));
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
    const updated = await run(backfillUpdate(sources));
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
  }
}
