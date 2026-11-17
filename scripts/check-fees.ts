/**
 * Read-only check of the stored HOA fees of every feed listing with a fee:
 *
 *   DATABASE_URL=... npm run check:fees
 *
 * Reports the fees by stored frequency, and fails (exit 1) on any row with a problem
 * (`classifyFeeRow` in src/lib/listings/fee-audit.ts): a frequency that isn't a RESO
 * FeeFrequency key, a Georgia MLS fee not stored as annually (the gamls2 feed sends no
 * frequency and its AssociationFee is the "Annual Association Fee", so the mapper resolves
 * every one to annually; null is a pre-mapper-5 row the resync corrects, 'monthly' the
 * original bug), or a SQL monthly equivalent (the search's) that differs from the JS one
 * (the page's). Only SELECTs, inside a read-only transaction that is rolled back.
 * DATABASE_URL comes from the environment only.
 */
import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { dataSources, listings } from "@/db/schema";
import { classifyFeeRow, FEE_PROBLEMS } from "@/lib/listings/fee-audit";
import { HOA_FREQUENCIES, monthlyHoaSql } from "@/lib/listings/hoa-fee";

const EXAMPLES = 10;

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    return 2;
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin transaction read only");
    const db = drizzle(client);
    const rows = await db
      .select({
        slug: listings.slug,
        fee: listings.hoaFee,
        frequency: listings.hoaFrequency,
        source: dataSources.slug,
        sqlMonthly: monthlyHoaSql(listings.hoaFee, listings.hoaFrequency).mapWith(
          (v: string | null) => (v === null ? null : Number(v)),
        ),
      })
      .from(listings)
      .innerJoin(dataSources, eq(dataSources.id, listings.sourceId))
      .where(and(eq(listings.fromFeed, true), gt(listings.hoaFee, 0)));
    await client.query("rollback");

    const byFrequency: Record<string, number> = {};
    const problems: Record<string, string[]> = Object.fromEntries(
      FEE_PROBLEMS.map((label) => [label, []]),
    );
    for (const r of rows) {
      const key = r.frequency ?? "(null)";
      byFrequency[key] = (byFrequency[key] ?? 0) + 1;
      for (const label of classifyFeeRow(r)) problems[label].push(r.slug);
    }

    console.info(`Feed listings with an HOA fee: ${rows.length}`);
    console.info("By stored hoa_frequency:");
    for (const [k, n] of Object.entries(byFrequency).sort((a, b) => b[1] - a[1]))
      console.info(`  ${k.padEnd(14)} ${n}`);
    console.info(`Known keys: ${HOA_FREQUENCIES.join(", ")}`);
    let failed = 0;
    for (const [label, slugs] of Object.entries(problems)) {
      console.info(`${label}: ${slugs.length}`);
      if (slugs.length) {
        failed += slugs.length;
        console.info(`  e.g. ${slugs.slice(0, EXAMPLES).join(", ")}`);
      }
    }
    console.info(failed ? "HOA fee check FAILED" : "HOA fee check passed");
    return failed ? 1 : 0;
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
