import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Sample photos that Unsplash no longer serves (404). They must never come back into the
 * seed or the pages: a broken image on a listing card looks like a broken site. Drizzle
 * migration 0014 repoints databases seeded before the fix. Add an id here when another
 * sample photo disappears (and replace it in scripts/seed-data.ts).
 */
const GONE = ["photo-1600607687644-c7171b42498b"];

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|json)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("sample photos", () => {
  it("the seed and the site never use a photo Unsplash no longer serves", () => {
    const offenders = [...files(join(ROOT, "scripts")), ...files(join(ROOT, "src"))].filter(
      (path) => GONE.some((id) => readFileSync(path, "utf8").includes(id)),
    );
    expect(offenders).toEqual([]);
  });

  it("the seed's pool still has a kitchen photo in its place", () => {
    const seed = readFileSync(join(ROOT, "scripts/seed-data.ts"), "utf8");
    expect(seed).toContain('["photo-1556912173-3bb406ef7e77", "Kitchen"]');
  });

  it("a migration repoints databases seeded before the fix", () => {
    const sql = readFileSync(join(ROOT, "drizzle/0014_fix_broken_sample_photo.sql"), "utf8");
    for (const id of GONE) expect(sql).toContain(id);
    expect(sql).toMatch(/UPDATE "listing_media"/);
    expect(sql).toMatch(/UPDATE "listings"/);
  });
});
