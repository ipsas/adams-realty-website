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
 */
import { execSync } from "node:child_process";
import pg from "pg";
import { shouldSyncFeed } from "../src/lib/mls/preview-sync.mjs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (!process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL is not set — skipping migrations. Add a Postgres database (e.g. Neon) to the project.",
  );
} else {
  run("npx drizzle-kit migrate");
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
    try {
      run("npx tsx scripts/add-gamls-source.ts");
      run("npx tsx scripts/sync.ts --minutes 2");
    } catch {
      console.warn("Georgia MLS feed load failed — continuing the build without it.");
    }
  } else {
    console.log(`MLS sync skipped: ${feed.reason}.`);
  }
}

run("npx next build");
