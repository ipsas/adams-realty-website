import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

// The schema files and the migrations must describe the same database. If they
// drift, the next `npm run db:generate` writes a migration that quietly
// "corrects" the database to the schema file, undoing whatever the last
// migration decided (e.g. 0011 hiding the firm's own Coming Soon listings via
// `idx_hidden`). This runs the same diff `drizzle-kit generate` does, against
// the latest migration's snapshot, and expects nothing to generate.

const DRIZZLE = fileURLToPath(new URL("../../../drizzle/", import.meta.url));

function latestSnapshot() {
  const journal = JSON.parse(readFileSync(`${DRIZZLE}meta/_journal.json`, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const last = journal.entries.at(-1)!;
  const file = `${DRIZZLE}meta/${String(last.idx).padStart(4, "0")}_snapshot.json`;
  return { tag: last.tag, snapshot: JSON.parse(readFileSync(file, "utf8")) };
}

describe("schema files vs. migrations", () => {
  it("the schema matches the latest migration: `db:generate` would write nothing", async () => {
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const { tag, snapshot } = latestSnapshot();
    const current = generateDrizzleJson(schema, snapshot.id);
    expect(await generateMigration(snapshot, current), `drift since ${tag}`).toEqual([]);
  });
});
