/**
 * Rewrites stale listings.keyword_tsv vectors (null, or built under an older
 * KEYWORD_TSV_VERSION: src/lib/search/keyword-text.ts), so a deploy serves keyword
 * search from current vectors before traffic switches (scripts/vercel-build.mjs
 * runs it after migrations). Short batches, each its own transaction; a stale row
 * stays searchable with its old vector until rewritten. Safe to re-run: it only
 * rewrites stale rows. With none left it records the version in app_flags.
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
  countStaleKeywordTsv,
  recordKeywordTsvVersion,
} from "@/lib/search/keyword-backfill";
import { KEYWORD_TSV_VERSION } from "@/lib/search/keyword-text";

const LIMIT = 2000;
/** Batches per progress line. */
const BATCHES = 10;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const minutes = Number(process.env.KEYWORD_BACKFILL_MINUTES);
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  const deadline = started + (minutes > 0 ? minutes : 20) * 60_000;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = drizzle(pool, { schema });
  try {
    const { filled, remaining } = await backfillUntilDone({
      fill: (deadline) => backfillKeywordTsv(db, { limit: LIMIT, batches: BATCHES, deadline }),
      remaining: () => countStaleKeywordTsv(db),
      deadline,
      progress: (filled, remaining) =>
        console.info(
          `Keyword backfill: rewrote ${filled}, remaining ${remaining}, seconds ${seconds()}`,
        ),
    });
    console.info(
      `Keyword backfill: rewrote ${filled}, remaining ${remaining}, seconds ${seconds()}` +
        (remaining ? " (the sync cron rewrites the rest)" : ""),
    );
    // False if a write made a row stale since the count: the sync cron records it later.
    if (remaining === 0 && (await recordKeywordTsvVersion(db))) {
      console.info(`Keyword backfill: vectors at version ${KEYWORD_TSV_VERSION}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`Keyword backfill failed: ${describeError(e)}`);
  process.exit(1);
});
