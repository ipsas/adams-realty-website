/**
 * Vercel build: apply database migrations, optionally create the demo office,
 * agents and logins in an empty database, then build Next.js. Runs
 * automatically on Vercel because package.json defines "vercel-build".
 *
 * The build never inserts listings. Demo seed (for previews): set
 * SEED_DEMO_DATA=1 and SEED_PASSWORD (the password for the demo logins). It
 * runs `seed.ts --no-listings`, and only when the agents table is empty, so it
 * can never overwrite real data (a database whose listings were deleted is not
 * re-seeded).
 *
 * MLS feed (previews only, since Vercel Cron doesn't run there): loaded only
 * when MLS_SYNC_ENABLED is exactly "true" and MLS_GAMLS_TOKEN and
 * MLS_GAMLS_DATASET are set (shouldSyncFeed in src/lib/mls/preview-sync.mjs).
 * It then runs only on the Neon preview branch (neonBranchVerdict, the purge's
 * check); on the production branch it fails the build.
 *
 * Preview purge (one-time, right after migrations): when VERCEL_ENV is
 * "preview" and MLS_PREVIEW_PURGE is exactly "true", scripts/preview-purge.mjs
 * deletes all listings and deactivates the demo and Georgia MLS sources, only
 * on the Neon preview branch; on the production branch it fails the build.
 *
 * Preview listing counts (previews only, after the MLS sync step): a
 * read-only report of listings per data source in the build log
 * (previewListingCounts). A failure there only logs; it never fails the build.
 */
import { execSync } from "node:child_process";
import pg from "pg";
import { shouldSyncFeed } from "../src/lib/mls/preview-sync.mjs";
import {
  neonBranchVerdict,
  previewListingCounts,
  purgeDecision,
  purgePreviewListings,
} from "./preview-purge.mjs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (!process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL is not set — skipping migrations. Add a Postgres database (e.g. Neon) to the project.",
  );
} else {
  run("npx drizzle-kit migrate");
  const purge = purgeDecision(process.env);
  if (purge.run) {
    // A production-branch connection throws here and fails the build.
    await purgePreviewListings(process.env.DATABASE_URL);
  } else {
    console.log(`Preview purge skipped: ${purge.reason}.`);
  }
  if (process.env.SEED_DEMO_DATA === "1") {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const { rows } = await client.query("select count(*)::int as n from agents");
    await client.end();
    if (rows[0].n > 0) {
      console.log(`Database already has ${rows[0].n} agents — not seeding demo data.`);
    } else if (!process.env.SEED_PASSWORD) {
      // The default demo password is published in the README; never use it on a public URL.
      console.error(
        "SEED_DEMO_DATA=1 needs SEED_PASSWORD (the password for the demo logins). Skipping seed.",
      );
      process.exitCode = 1;
      throw new Error("Set SEED_PASSWORD to load demo data.");
    } else {
      run("npx tsx scripts/seed.ts --force --no-listings");
    }
  }
  const feed = shouldSyncFeed(process.env);
  if (feed.run) {
    const verdict = await neonBranchVerdict(process.env.DATABASE_URL, "MLS sync");
    if (verdict === "fatal") {
      throw new Error("MLS sync: connected to the production branch; refusing and failing.");
    }
    if (verdict === "refuse") {
      console.log("MLS sync refused: not the Neon preview branch; nothing written.");
    } else if (verdict === "ok") {
      try {
        run("npx tsx scripts/add-gamls-source.ts");
        run("npx tsx scripts/sync.ts --minutes 2");
      } catch {
        console.warn("Georgia MLS feed load failed — continuing the build without it.");
      }
    }
  } else {
    console.log(`MLS sync skipped: ${feed.reason}.`);
  }
  if (process.env.VERCEL_ENV === "preview") {
    try {
      await previewListingCounts(process.env.DATABASE_URL);
    } catch (e) {
      console.warn(`Preview listing counts failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}

run("npx next build");
