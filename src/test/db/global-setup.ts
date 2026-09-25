import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

/**
 * The db test project's database (see vitest.config.mts): dropped, created
 * and migrated before the run, dropped after it. Refuses any name that
 * doesn't end in `_test`, so it can never touch the app's database.
 */

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

function names() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (vitest.config.mts sets it).");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`refusing to use "${name}" as the test database: it must end in _test`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return { url, name, admin: admin.toString() };
}

async function onAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const { admin, url } = names();
  const client = new Client({ connectionString: admin });
  try {
    await client.connect();
  } catch (e) {
    const { host } = new URL(url);
    throw new Error(
      `The database tests need the local Postgres (${host}): ${e instanceof Error ? e.message : e}. ` +
        "Start it (README → Setup), or run `npx vitest run --project unit` for the unit tests alone.",
    );
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export default async function setup() {
  const { url, name } = names();
  await onAdmin(async (c) => {
    await c.query(`drop database if exists "${name}" with (force)`);
    await c.query(`create database "${name}"`);
  });
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.end();
  }
  return async () => {
    await onAdmin((c) => c.query(`drop database if exists "${name}" with (force)`));
  };
}
