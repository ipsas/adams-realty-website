/**
 * Runs the app's real search and listing queries against `adams_perf`
 * (build it with `npm run perf:seed`), captures the SQL they send, and times
 * every statement with EXPLAIN (ANALYZE, BUFFERS): the median of 5 runs. Dev-only.
 *
 *   npm run perf:measure                          # label "latest"
 *   npm run perf:measure -- --label before
 *   npm run perf:measure -- --label after --compare before --check
 *
 * Plans and results land in scripts/perf/out/<label>/ (git-ignored).
 * `--compare <label>` prints the earlier run's numbers beside this one;
 * `--check` exits 1 when a target or a correctness check fails.
 *
 * Timings are statement execution times on a warm local cache. Allow 2–5×
 * on a small Neon compute, plus a network round trip per statement.
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { assertPerfUrl, PERF_URL, SMALL_BOX } from "./perf-db";

const url = assertPerfUrl(PERF_URL);
// Must be set before anything imports @/db (it reads the URL once).
process.env.DATABASE_URL = url;

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("--label") ?? "latest";
const compareTo = flag("--compare");
const check = argv.includes("--check");
const OUT_ROOT = path.resolve("scripts/perf/out");
const OUT = path.join(OUT_ROOT, label);
fs.mkdirSync(OUT, { recursive: true });

type Statement = { execMs: number; file: string; plan: string };
type Result = {
  name: string;
  /** End-to-end median of 5 runs of the app function, in ms. */
  medianMs: number;
  statements: Statement[];
  /** Per-statement targets (ms), by index; undefined = not targeted. */
  targets: (number | undefined)[];
  note?: string;
};

type Captured = { text: string; values: unknown[] };

async function main() {
  const { db } = await import("@/db");
  const { listings } = await import("@/db/schema");
  const { and, sql } = await import("drizzle-orm");
  const { parseSearchParams } = await import("@/lib/search/params");
  const { buildOrderBy, buildWhere } = await import("@/lib/search/query");
  const { locationPins, searchListings, searchMapPins } = await import("@/lib/search/service");
  const queries = await import("@/lib/listings/queries");

  const pool = (globalThis as unknown as { pgPool: { query: (...a: unknown[]) => unknown } })
    .pgPool;
  const original = pool.query.bind(pool);
  let captured: Captured[] | null = null;
  pool.query = (...args: unknown[]) => {
    if (captured) {
      const a = args[0] as string | { text: string; values?: unknown[] };
      if (typeof a === "string") captured.push({ text: a, values: (args[1] as unknown[]) ?? [] });
      else captured.push({ text: a.text, values: a.values ?? (args[1] as unknown[]) ?? [] });
    }
    return original(...args);
  };

  const explainer = new Client({ connectionString: url });
  await explainer.connect();
  const results: Result[] = [];
  const failures: string[] = [];

  async function scenario(
    name: string,
    fn: () => Promise<unknown>,
    targets: (number | undefined)[],
    note?: (r: unknown) => string,
  ) {
    let last = await fn(); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      last = await fn();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    captured = [];
    await fn();
    // Planner-only statements (searchMapPins' row estimates) aren't timed.
    const stmts = (captured as Captured[]).filter((x) => !/^\s*explain\b/i.test(x.text));
    captured = null;
    const statements: Statement[] = [];
    for (let k = 0; k < stmts.length; k++) {
      const s = stmts[k];
      const execs: number[] = [];
      let plan: string[] = [];
      for (let n = 0; n < 5; n++) {
        const r = await explainer.query(`explain (analyze, buffers) ${s.text}`, s.values);
        plan = r.rows.map((x: Record<string, string>) => x["QUERY PLAN"]);
        execs.push(Number(/Execution Time: ([\d.]+)/.exec(plan.join("\n"))?.[1] ?? NaN));
      }
      execs.sort((a, b) => a - b);
      const file = `${name.replace(/[^a-z0-9]+/gi, "_")}_${k + 1}.txt`;
      fs.writeFileSync(
        path.join(OUT, file),
        `-- ${name} #${k + 1}\n${s.text}\n-- params: ${JSON.stringify(s.values)}\n\n${plan.join("\n")}\n`,
      );
      const top = plan.find((l) => /Scan|Aggregate|Sort/.test(l))?.trim() ?? "";
      statements.push({ execMs: execs[2], file, plan: top.slice(0, 90) });
    }
    const res: Result = { name, medianMs: times[2], statements, targets, note: note?.(last) };
    results.push(res);
    const cells = statements.map((s, i) => {
      const t = targets[i];
      const ok = t === undefined || s.execMs <= t;
      if (!ok) failures.push(`${name} #${i + 1}: ${s.execMs.toFixed(1)} ms > ${t} ms`);
      return `${s.execMs.toFixed(1)}${t === undefined ? "" : ok ? `≤${t}` : ` MISS(${t})`}`;
    });
    console.info(
      `${name.padEnd(34)} ${res.medianMs.toFixed(1).padStart(7)} ms  [${cells.join(", ")}]${res.note ? "  " + res.note : ""}`,
    );
  }

  const crit = (qs: string) => parseSearchParams(Object.fromEntries(new URLSearchParams(qs)));
  const total = (r: unknown) => `total=${(r as { total: number }).total}`;
  const rows = (r: unknown) => `${(r as unknown[]).length} rows`;
  const GA = "-85.61,30.36,-80.84,35.0";
  const ATL = "-84.6,33.55,-84.1,34.05";
  const SMALL = `${SMALL_BOX.west},${SMALL_BOX.south},${SMALL_BOX.east},${SMALL_BOX.north}`;

  // [label, query string, [cards, count] targets, pins target]
  // A location search's pins either walk the order index or collect every
  // match (`walkPins` in src/lib/search/service.ts picks). Either way a place
  // with thousands of matches reads one heap row per match (about 1 µs each
  // here), so it can't meet the 5 ms of a plain search: Q_PINS for sale,
  // SOLD_Q_PINS for sold mode, whose places have three times the matches
  // (sold q=Savannah collects 5,600). Pins run in parallel with the list and
  // the count (src/app/homes/page.tsx).
  const Q_PINS = 12;
  const SOLD_Q_PINS = 20;
  const searches: [string, string, [number?, number?], number?][] = [
    ["default /homes", "", [2, 10], 5],
    ["sort=newest", "sort=newest", [2]],
    ["sort=price_asc", "sort=price_asc", [2]],
    ["sort=price_desc", "sort=price_desc", [2]],
    ["sort=sqft_desc", "sort=sqft_desc", [2]],
    ["sort=price_per_sqft_asc", "sort=price_per_sqft_asc", [2]],
    ["page=50", "page=50", [5]],
    ["page=500", "page=500", [40]],
    ["statewide bounds", `bounds=${GA}`, [2, 10], 5],
    ["metro Atlanta bounds", `bounds=${ATL}`, [2, 10], 5],
    ["small rural box (3 homes)", `bounds=${SMALL}`, [2, 2], 2],
    ["q=Atlanta", "q=Atlanta", [5, 40], Q_PINS],
    ["q=Lake Hartwell", "q=Lake+Hartwell", [5, 20], Q_PINS],
    ["q=Savannah, GA", "q=Savannah%2C+GA", [5, 20], Q_PINS],
    ["q=Peachtree (street)", "q=Peachtree", [5, 20], Q_PINS],
    ["q=Lake Lanier", "q=Lake+Lanier", [5, 20], Q_PINS],
    ["q=30662 (zip)", "q=30662", [5, 5], 5],
    ["price 300-500k, 3+ beds", "minPrice=300000&maxPrice=500000&beds=3", [5, 20]],
    ["mode=sold", "mode=sold", [5, 40], 10],
    ["mode=sold q=Atlanta", "mode=sold&q=Atlanta", [5, 40], SOLD_Q_PINS],
    ["mode=sold q=Savannah", "mode=sold&q=Savannah", [5, 20], SOLD_Q_PINS],
    // The lake's 3,000 sold homes are collected for the page too (the planner
    // can't tell how common "lake & lanier" is): about 1 µs a match plus the sort.
    ["mode=sold q=Lake Lanier", "mode=sold&q=Lake+Lanier", [10, 20], SOLD_Q_PINS],
    ["mode=sold sort=price_asc", "mode=sold&sort=price_asc", [2]],
    ["mode=sold sort=price_desc", "mode=sold&sort=price_desc", [2]],
    ["mode=sold sort=sqft_desc", "mode=sold&sort=sqft_desc", [2]],
    ["mode=sold sort=price_per_sqft_asc", "mode=sold&sort=price_per_sqft_asc", [2]],
    ["mode=sold sort=newest", "mode=sold&sort=newest", [2]],
    ["mode=rent", "mode=rent", [2, 5], 5],
    ["pending=1", "pending=1", [2, 15], 5],
    ["pending=1 q=Savannah", "pending=1&q=Savannah", [5, 20], Q_PINS],
    ["ATL box + price + beds", `bounds=${ATL}&minPrice=300000&maxPrice=500000&beds=3`, [5, 10]],
  ];
  for (const [name, qs, [cards, count], pins] of searches) {
    await scenario(`list ${name}`, () => searchListings(crit(qs)), [cards, count], total);
    if (pins !== undefined) {
      await scenario(`pins ${name}`, () => searchMapPins(crit(qs)), [pins], rows);
    }
  }

  // Sorts without an index of their own: informational, no target.
  for (const qs of ["mode=rent&sort=price_asc", "pending=1&sort=newest"]) {
    await scenario(`list ${qs}`, () => searchListings(crit(qs)), [], total);
  }

  // Autocomplete reads one heap row per live listing whose town or subdivision
  // starts with the prefix: "Atl" is about 6,400 rows (8–10 ms). The `places`
  // materialized view handed to WP4 makes every prefix well under 1 ms.
  for (const term of ["Sav", "Atl", "Ro", "306", "Lake H", "123 Oak"]) {
    await scenario(`suggest '${term}'`, () => queries.getLocationSuggestions(term), [15, 15], rows);
  }
  await scenario("home getNewestListings(4)", () => queries.getNewestListings(4), [2], rows);
  await scenario("home getFeaturedListings(8)", () => queries.getFeaturedListings(8), [], rows);
  await scenario("home getMarketStats", () => queries.getMarketStats(), []);
  await scenario("home getPopularAreas(9)", () => queries.getPopularAreas(9), [], rows);
  // Cached (GA-C2), so no target: they run once per sync, not per request.
  await scenario("GA-A getTopCities(12)", () => queries.getTopCities(12), [], rows);
  await scenario("GA-A getPlacesIndex()", () => queries.getPlacesIndex(), [], rows);

  // Correctness: a location search returns places, not descriptions.
  type LocRow = {
    city: string;
    address: string;
    zip: string;
    neighborhood: string | null;
    waterBody: string | null;
    mls: string | null;
  };
  const locRows = (qs: string) =>
    db
      .select({
        city: listings.city,
        address: listings.addressLine1,
        zip: listings.postalCode,
        neighborhood: listings.neighborhood,
        waterBody: listings.waterBodyName,
        mls: listings.mlsNumber,
      })
      .from(listings)
      .where(buildWhere(crit(qs))) as Promise<LocRow[]>;
  const buyCount = async (where: ReturnType<typeof sql>) => {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(buildWhere(crit("")), where));
    return r.n;
  };
  const mentions = (r: LocRow, word: string) =>
    [r.city, r.address, r.zip, r.neighborhood, r.waterBody, r.mls].some((v) =>
      v?.toLowerCase().includes(word),
    );
  const checks: [string, boolean, string][] = [];
  {
    const got = await locRows("q=Atlanta");
    const inCity = await buyCount(sql`${listings.city} = 'Atlanta'`);
    const gotCity = got.filter((r) => r.city === "Atlanta").length;
    const descOnly = got.filter((r) => !mentions(r, "atlanta")).length;
    const hwy = got.filter((r) => r.city !== "Atlanta" && /atlanta h/i.test(r.address)).length;
    checks.push([
      "q=Atlanta contains every city=Atlanta listing",
      gotCity === inCity,
      `${gotCity} of ${inCity}`,
    ]);
    checks.push([
      "q=Atlanta has no description-only match",
      descOnly === 0,
      `${descOnly} description-only of ${got.length} (incl. ${hwy} "Atlanta Highway" rows elsewhere)`,
    ]);
  }
  {
    const got = await locRows("q=Lake+Hartwell");
    const onLake = await buyCount(sql`${listings.waterBodyName} = 'Lake Hartwell'`);
    const gotLake = got.filter((r) => r.waterBody === "Lake Hartwell").length;
    checks.push([
      "q=Lake Hartwell finds every home whose WaterBodyName is Lake Hartwell",
      onLake > 0 && gotLake === onLake,
      `${gotLake} of ${onLake}`,
    ]);
  }
  // Collected pins (`locationPins`) are the walked ones: the first 750 matches in order.
  for (const qs of ["q=Savannah", "mode=sold&q=Savannah", "q=Atlanta", "mode=sold&q=Atlanta"]) {
    const c = crit(qs);
    const pins = await locationPins(c);
    const walked = await db
      .select({ id: listings.id })
      .from(listings)
      .where(buildWhere(c))
      .orderBy(...buildOrderBy(c))
      .limit(750);
    const same = pins.length === walked.length && pins.every((p, i) => p.id === walked[i].id);
    checks.push([
      `${qs}: collected pins match the ordered walk`,
      same,
      `${pins.length} pins, ${same ? "identical" : "different"}`,
    ]);
  }
  {
    const n = (await searchListings(crit(`bounds=${SMALL}`))).total;
    checks.push(["the small rural box holds exactly its 3 fixture homes", n === 3, `${n}`]);
  }
  for (const [name, ok, detail] of checks) {
    console.info(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
    if (!ok) failures.push(`${name}: ${detail}`);
  }

  const size = await explainer.query<{ relname: string; mb: number }>(
    `select relname, round(pg_total_relation_size(oid) / 1048576.0)::int as mb from pg_class
     where relname in ('listings', 'listing_media') union all
     select 'database', round(pg_database_size(current_database()) / 1048576.0)::int`,
  );
  console.info(size.rows.map((r) => `${r.relname} ${r.mb} MB`).join(", "));

  fs.writeFileSync(
    path.join(OUT, "results.json"),
    JSON.stringify({ label, results, checks, size: size.rows }, null, 2),
  );

  if (compareTo) {
    const prevFile = path.join(OUT_ROOT, compareTo, "results.json");
    const prev: { results: Result[] } = JSON.parse(fs.readFileSync(prevFile, "utf8"));
    const byName = new Map(prev.results.map((r) => [r.name, r]));
    console.info(`\n| Query | ${compareTo} (ms) | ${label} (ms) | Target |`);
    console.info("| --- | --- | --- | --- |");
    for (const r of results) {
      const p = byName.get(r.name);
      const fmt = (x?: Result) => x?.statements.map((s) => s.execMs.toFixed(1)).join(" / ") ?? "–";
      const t = r.targets.map((x) => (x === undefined ? "–" : `≤ ${x}`)).join(" / ");
      console.info(`| ${r.name} | ${fmt(p)} | ${fmt(r)} | ${t} |`);
    }
  }

  await explainer.end();
  if (failures.length) {
    console.info(`\n${failures.length} target(s) or check(s) missed:\n- ${failures.join("\n- ")}`);
  }
  process.exit(check && failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
