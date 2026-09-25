/**
 * Vercel build: apply database migrations, optionally load demo data into an
 * empty database, then build Next.js. Runs automatically on Vercel because
 * package.json defines "vercel-build".
 *
 * Demo data (for previews): set SEED_DEMO_DATA=1 and SEED_PASSWORD (the
 * password for the demo logins). Seeding only ever runs when the listings
 * table is empty, so it can never overwrite real data.
 */
import { execSync } from "node:child_process";
import pg from "pg";

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
    const { rows } = await client.query("select count(*)::int as n from listings");
    await client.end();
    if (rows[0].n > 0) {
      console.log(`Database already has ${rows[0].n} listings — not seeding demo data.`);
    } else if (!process.env.SEED_PASSWORD) {
      // The default demo password is published in the README; never use it on a public URL.
      console.error(
        "SEED_DEMO_DATA=1 needs SEED_PASSWORD (the password for the demo logins). Skipping seed.",
      );
      process.exitCode = 1;
      throw new Error("Set SEED_PASSWORD to load demo data.");
    } else {
      run("npx tsx scripts/seed.ts --force");
    }
  }
}

run("npx next build");
