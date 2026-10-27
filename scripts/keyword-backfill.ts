/**
 * Fills listings.keyword_tsv where it is null, so a deploy serves keyword
 * search from fresh vectors before traffic switches (scripts/vercel-build.mjs
 * runs it after migrations; a migration that resets keyword_tsv, like 0024,
 * leaves every row null). Safe to re-run: it only fills null rows.
 *
 *   npx tsx scripts/keyword-backfill.ts
 *
 * Stops after KEYWORD_BACKFILL_MINUTES (default 20) with rows left, logging how
 * many; the sync cron (every 15 minutes) finishes them. Exits 1 on an error (a
 * rerun resumes). Logs counts only, never row content.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { describeError } from "@/lib/mls/write-errors";
import {
  backfillKeywordTsv,
  backfillUntilDone,
  countMissingKeywordTsv,
} from "@/lib/search/keyword-backfill";

const LIMIT = 2000;
/** Batches per progress line. */
const BATCHES = 10;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const minutes = Number(process.env.KEYWORD_BACKFILL_MINUTES);
  const started = Date.now();
  const deadline = started + (minutes > 0 ? minutes : 20) * 60_000;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = drizzle(pool, { schema });
  try {
    const { filled, remaining } = await backfillUntilDone({
      fill: (deadline) => backfillKeywordTsv(db, { limit: LIMIT, batches: BATCHES, deadline }),
      remaining: () => countMissingKeywordTsv(db),
      deadline,
      progress: (filled, remaining) =>
        console.info(`Keyword backfill: filled ${filled}, remaining ${remaining}`),
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    console.info(
      `Keyword backfill: filled ${filled}, remaining ${remaining}, seconds ${seconds}` +
        (remaining ? " (the sync cron fills the rest)" : ""),
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`Keyword backfill failed: ${describeError(e)}`);
  process.exit(1);
});
