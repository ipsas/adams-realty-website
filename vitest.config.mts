import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

/**
 * Two projects, both run by `npm test`:
 * - unit: every `*.test.ts`, no database.
 * - db: every `*.db.test.ts`, against a throwaway Postgres database named
 *   after the app's with `_test` appended (adams_realty → adams_realty_test),
 *   created and migrated fresh on each run (src/test/db/global-setup.ts) and
 *   dropped afterwards. It needs the local Postgres the app uses (README →
 *   Setup); the app's own database is never touched.
 */
const DB_TESTS = "src/**/*.db.test.ts";

const appUrl =
  process.env.DATABASE_URL ??
  (existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined) ??
  "postgres://adams:adams@localhost:5432/adams_realty";
const testUrl = new URL(appUrl);
const appDb = testUrl.pathname.replace(/^\//, "");
testUrl.pathname = `/${appDb.endsWith("_test") ? appDb : `${appDb}_test`}`;
// Read by the global setup, which runs in this process.
process.env.TEST_DATABASE_URL = testUrl.toString();

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"], exclude: [DB_TESTS] },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: [DB_TESTS],
          env: { DATABASE_URL: testUrl.toString() },
          globalSetup: ["src/test/db/global-setup.ts"],
          // One database: files take turns.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
