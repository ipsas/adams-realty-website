/**
 * Read-only check of the stored HOA fees of every feed listing with a fee:
 *
 *   DATABASE_URL=... npm run check:fees
 *
 * Reports the fees by stored frequency, and fails (exit 1) on any frequency that isn't a
 * RESO FeeFrequency key, any Georgia MLS fee with no stored frequency (the mapper resolves
 * every Georgia MLS fee to the frequency the record sends, or to annually since its
 * AssociationFee is the "Annual Association Fee", so a null one is a pre-mapper-5 row the
 * resync corrects), and any row whose SQL monthly equivalent (the search's) differs from
 * the JS one (the page's). Only SELECTs, inside a read-only transaction that is rolled
 * back. DATABASE_URL comes from the environment only.
 */
import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { dataSources, listings } from "@/db/schema";
import {
  HOA_FREQUENCIES,
  isHoaFrequency,
  monthlyHoaEquivalent,
  monthlyHoaSql,
} from "@/lib/listings/hoa-fee";
import { GAMLS_SLUG } from "@/lib/mls/gamls";

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
    const problems: Record<string, string[]> = {
      "frequency not a RESO FeeFrequency key": [],
      "Georgia MLS fee with no stored frequency": [],
      "SQL monthly equivalent differs from JS": [],
    };
    const [unknownKey, gamlsNoFrequency, drift] = Object.values(problems);
    for (const r of rows) {
      const key = r.frequency ?? "(null)";
      byFrequency[key] = (byFrequency[key] ?? 0) + 1;
      if (r.frequency !== null && !isHoaFrequency(r.frequency)) unknownKey.push(r.slug);
      if (r.source === GAMLS_SLUG && r.frequency === null) gamlsNoFrequency.push(r.slug);
      const js = monthlyHoaEquivalent(r.fee, r.frequency);
      const sqlValue = r.sqlMonthly;
      if ((js === null) !== (sqlValue === null) || Math.abs((js ?? 0) - (sqlValue ?? 0)) > 0.01)
        drift.push(r.slug);
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
