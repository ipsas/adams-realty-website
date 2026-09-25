import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listings } from "@/db/schema";
import { normalizedSql } from "@/lib/areas/match";
import { parseSearchParams, SORTS } from "./params";
import { buildConditions, buildOrderBy } from "./query";

/**
 * The statewide feed is only fast if every search the site sends can read its
 * page straight off an index (scripts/perf measures it). That holds only while
 * the migrations' indexes match `buildOrderBy` exactly (columns, direction,
 * nulls placement, id tiebreak) and each partial index's predicate is part of
 * the WHERE clause `buildConditions` sends. These tests read the indexes from
 * the migration SQL itself (what the database actually has), so changing a
 * sort order, a mode's filter or an index without the other fails here.
 */

const dialect = new PgDialect();
const now = new Date("2026-09-25T12:00:00Z");

type Index = {
  name: string;
  method: string;
  columns: string[];
  include: string[];
  where: string[];
};

/** "a, (b, c) desc, d" → ["a", "(b, c) desc", "d"]: split on commas outside parentheses and quotes. */
function splitTopLevel(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === "(") depth++;
    else if (!quoted && ch === ")") depth--;
    else if (!quoted && depth === 0) {
      const m = sep.exec(s.slice(i));
      if (m && m.index === 0) {
        out.push(s.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Lowercase, unquoted, unqualified, single-spaced. */
function norm(s: string): string {
  return s
    .replace(/"listings"\./g, "")
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** One sort key as "expr asc|desc nulls first|last", with Postgres' defaults filled in. */
function sortKey(raw: string): string {
  let s = norm(raw);
  let nulls: string | undefined;
  const n = / nulls (first|last)$/.exec(s);
  if (n) {
    nulls = n[1];
    s = s.slice(0, n.index);
  }
  let dir = "asc";
  const d = / (asc|desc)$/.exec(s);
  if (d) {
    dir = d[1];
    s = s.slice(0, d.index);
  }
  return `${s} ${dir} nulls ${nulls ?? (dir === "desc" ? "first" : "last")}`;
}

/** The listings indexes left after applying every migration in journal order. */
function listingIndexes(): Map<string, Index> {
  const dir = path.resolve("drizzle");
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const indexes = new Map<string, Index>();
  for (const e of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const text = fs.readFileSync(path.join(dir, `${e.tag}.sql`), "utf8");
    for (let stmt of text.split("--> statement-breakpoint")) {
      stmt = stmt
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith("--"))
        .join(" ")
        .replace(/;\s*$/, "")
        .trim();
      const drop = /^DROP INDEX (?:IF EXISTS )?"([^"]+)"/i.exec(stmt);
      if (drop) indexes.delete(drop[1]);
      const create =
        /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)" ON "listings" USING (\w+) \((.*?)\)(?: INCLUDE \((.*?)\))?(?: WHERE (.*))?$/i.exec(
          stmt,
        );
      if (!create) continue;
      const [, name, method, , include, where] = create;
      // The column list may itself contain parentheses: re-split the whole tail.
      const tail = stmt.slice(stmt.indexOf(`USING ${method} (`) + `USING ${method} (`.length);
      let depth = 1;
      let end = 0;
      for (; end < tail.length && depth > 0; end++) {
        if (tail[end] === "(") depth++;
        if (tail[end] === ")") depth--;
      }
      const columns = splitTopLevel(tail.slice(0, end - 1), /^,/);
      indexes.set(name, {
        name,
        method: method.toLowerCase(),
        columns: method.toLowerCase() === "btree" ? columns.map(sortKey) : columns.map(norm),
        include: include ? splitTopLevel(include, /^,/).map(norm) : [],
        where: where ? splitTopLevel(norm(where), /^ and /) : [],
      });
    }
  }
  return indexes;
}

/**
 * Renders a condition with its parameters inlined as literals, normalized like
 * index predicates. A one-value IN becomes `=`, as Postgres' parser does.
 */
function inline(fragment: SQL): string {
  const { sql, params } = dialect.sqlToQuery(fragment);
  return norm(
    sql.replace(/\$(\d+)/g, (_, i) => {
      const v = params[Number(i) - 1];
      return typeof v === "number" ? String(v) : `'${String(v)}'`;
    }),
  ).replace(/^(\w+) in \(('[^']*')\)$/, "$1 = $2");
}

const indexes = listingIndexes();

/** Indexes whose key columns are exactly the ORDER BY and whose predicate the WHERE implies. */
function servingIndexes(query: Record<string, string>): Index[] {
  const c = parseSearchParams(query);
  const order = buildOrderBy(c).map((o) => sortKey(dialect.sqlToQuery(o).sql));
  const conds = new Set(buildConditions(c, now).map(inline));
  return [...indexes.values()].filter(
    (ix) =>
      ix.method === "btree" &&
      ix.columns.join(", ") === order.join(", ") &&
      ix.where.every((w) => conds.has(w)),
  );
}

describe("migration indexes vs buildOrderBy/buildConditions", () => {
  it("parses the migrations", () => {
    expect(indexes.get("listings_source_key_idx")?.columns).toEqual([
      "source_id asc nulls last",
      "listing_key asc nulls last",
    ]);
    // Dropped in 0005: bounds are BETWEEN ranges now.
    expect(indexes.has("listings_geo_idx")).toBe(false);
  });

  it.each(SORTS)("buy mode, sort=%s: one partial index serves the page in order", (sort) => {
    const found = servingIndexes({ sort });
    expect(found.map((i) => i.name)).toHaveLength(1);
    expect(found[0].where.length).toBeGreaterThan(0);
  });

  it.each(SORTS)("pending=1, sort=%s: one partial index serves the page in order", (sort) => {
    const found = servingIndexes({ sort, pending: "1" });
    expect(found.map((i) => i.name)).toHaveLength(1);
    expect(found[0].where.join(" and ")).toContain("'active_under_contract', 'pending'");
  });

  it.each([
    ["rent (recommended)", { mode: "rent" }],
    ["sold (recommended)", { mode: "sold" }],
    ["sold, recently sold first", { mode: "sold", sort: "newest" }],
  ])("%s: a partial index serves the page in order", (_, query) => {
    expect(servingIndexes(query).length).toBeGreaterThan(0);
  });

  it("a buy-mode map viewport has a covering lat/lng index", () => {
    const c = parseSearchParams({ bounds: "-84.6,33.55,-84.1,34.05" });
    const conds = new Set(buildConditions(c, now).map(inline));
    const geo = [...indexes.values()].filter(
      (ix) =>
        ix.columns[0]?.startsWith("latitude ") &&
        ix.columns[1]?.startsWith("longitude ") &&
        ix.where.every((w) => conds.has(w)),
    );
    expect(geo.map((i) => i.name)).toEqual(["listings_buy_geo_idx"]);
    expect(geo[0].include).toEqual(["list_price"]);
    expect(conds.has("longitude between -84.6 and -84.1")).toBe(true);
  });

  it("every branch of the location box has an index", () => {
    const methodOf = (column: string) =>
      [...indexes.values()]
        .filter((ix) => ix.where.length === 0 && ix.columns[0]?.startsWith(column))
        .map((ix) => ix.method);
    expect(methodOf("location_vector")).toContain("gin");
    expect(methodOf("city gin_trgm_ops")).toContain("gin");
    expect(methodOf("neighborhood gin_trgm_ops")).toContain("gin");
    expect(methodOf("address_line1 gin_trgm_ops")).toContain("gin");
    expect(methodOf("mls_number")).toContain("btree");
    // The area-guide branch compares exactly this expression.
    for (const column of [listings.neighborhood, listings.waterBodyName, listings.city]) {
      const expr = `${norm(dialect.sqlToQuery(normalizedSql(column)).sql)} asc nulls last`;
      expect(
        [...indexes.values()].some((ix) => ix.where.length === 0 && ix.columns[0] === expr),
      ).toBe(true);
    }
  });
});
