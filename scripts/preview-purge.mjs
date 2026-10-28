/**
 * One-time purge of the preview database's listings, run by the Vercel build
 * (scripts/vercel-build.mjs) when purgeDecision allows it. It deletes only on
 * the Neon preview branch, read from the connection itself; on the production
 * branch it throws so the build fails. Deleting listings cascades to their
 * media, open houses, events, saves and views and clears inquiries.listing_id
 * (src/db/schema). Logs Neon ids and counts only, never connection details.
 */
import pg from "pg";
import {
  buildDbDecision,
  checkBranch,
  isTrustedSettingSource,
  newBranchCheckClient,
  purgeDecision,
  trustedNeonIds,
} from "../src/lib/mls/preview-purge.mjs";

export { buildDbDecision, checkBranch, purgeDecision };

/** The demo feed (scripts/seed.ts) and Georgia MLS via Bridge (src/lib/mls/gamls.ts). */
const SOURCE_SLUGS = ["demo-mls", "gamls"];

/*
 * Branch-check SQL names every catalog object, function and operator by
 * pg_catalog, so a user object earlier in search_path cannot shadow it.
 */

/** A setting's value, or null if it does not exist. */
async function showSetting(client, name) {
  try {
    const { rows } = await client.query("select pg_catalog.current_setting($1, true) as v", [name]);
    return rows[0]?.v || null;
  } catch {
    return null;
  }
}

/**
 * The first DNS label of the connection's host if it is a Neon endpoint id
 * (ep-..., host under .neon.tech), else null. Never the full host.
 * @param {string} connectionString
 * @returns {string | null}
 */
export function neonEndpointLabel(connectionString) {
  let hostname;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    return null;
  }
  const label = hostname.split(".")[0];
  return hostname.endsWith(".neon.tech") && /^ep-[a-z0-9-]+$/.test(label) ? label : null;
}

/** Rows of pg_db_role_setting with a neon.* entry, or null if unreadable. */
async function neonRoleSettingCount(client) {
  try {
    const { rows } = await client.query(`select pg_catalog.count(*)::int as n
      from pg_catalog.pg_db_role_setting s, pg_catalog.unnest(s.setconfig) c
      where pg_catalog.starts_with(c, 'neon.')`);
    return rows[0].n;
  } catch {
    return null;
  }
}

/**
 * The connection's Neon ids, as trustedNeonIds decides: an id is trusted only
 * from a pg_settings row whose source is "configuration file" or "command
 * line", and only when no neon.* role/database settings exist. An untrusted id
 * is null (logged by condition, never the value), so the verdict treats it as
 * missing.
 */
async function neonIds(client, label, log) {
  /** @type {Record<string, { source: string | null, value: string | null }>} */
  const settings = {};
  for (const name of ["neon.project_id", "neon.branch_id"]) {
    const { rows } = await client.query(
      "select source from pg_catalog.pg_settings where name OPERATOR(pg_catalog.=) $1",
      [name],
    );
    const source = rows[0]?.source ?? null;
    log(`${label} branch check: ${name} pg_settings source=${source ?? "none"}`);
    settings[name] = {
      source,
      value: isTrustedSettingSource(source) ? await showSetting(client, name) : null,
    };
  }
  const roleSettings = await neonRoleSettingCount(client);
  log(`${label} branch check: neon.* role/database settings=${roleSettings ?? "unreadable"}`);
  const { projectId, branchId, reasons } = trustedNeonIds({ settings, roleSettings });
  for (const reason of reasons) log(`${label} branch check: ${reason}; not trusted, ignored.`);
  return { projectId, branchId };
}

async function counts(client) {
  const { rows } = await client.query(`select
    (select count(*)::int from listings) as listings,
    (select count(*)::int from listing_media) as listing_media,
    (select count(*)::int from open_houses) as open_houses,
    (select count(*)::int from listing_events) as listing_events,
    (select count(*)::int from saved_listings) as saved_listings,
    (select count(*)::int from inquiries where listing_id is not null) as inquiries_with_listing`);
  const sources = await client.query(
    "select slug, is_active from data_sources where slug = any($1) order by slug",
    [SOURCE_SLUGS],
  );
  return {
    ...rows[0],
    data_sources: Object.fromEntries(sources.rows.map((r) => [r.slug, r.is_active])),
  };
}

/** Reads the Neon ids from an open client, logs them (ids only) and returns checkBranch's verdict. */
async function branchVerdict(client, label, log) {
  const { projectId, branchId } = await neonIds(client, label, log);
  const verdict = checkBranch({ projectId, branchId });
  log(`${label} branch check: project=${projectId} branch=${branchId} -> ${verdict}`);
  return verdict;
}

/**
 * The purge's branch check on its own connection: "ok" only on the Neon
 * preview branch, "fatal" on the production branch, "refuse" otherwise.
 * @param {string} connectionString
 * @param {string} label
 * @param {(line: string) => void} [log]
 */
export async function neonBranchVerdict(connectionString, label, log = console.log) {
  const client = newBranchCheckClient(pg.Client, connectionString);
  await client.connect();
  try {
    return await branchVerdict(client, label, log);
  } finally {
    await client.end();
  }
}

/**
 * The build's database guard on its own connection: buildDbDecision for
 * VERCEL_ENV and the connection's Neon ids. Logs ids only.
 * @param {string} connectionString
 * @param {(line: string) => void} [log]
 * @returns {Promise<"ok" | "refuse" | "fatal">}
 */
export async function buildDbVerdict(connectionString, log = console.log) {
  const client = newBranchCheckClient(pg.Client, connectionString);
  await client.connect();
  try {
    log(`Database branch check: host endpoint=${neonEndpointLabel(connectionString) ?? "none"}`);
    const { projectId, branchId } = await neonIds(client, "Database", log);
    const env = process.env.VERCEL_ENV;
    const verdict = buildDbDecision(env, { projectId, branchId });
    log(`Database branch check: env=${env} project=${projectId} branch=${branchId} -> ${verdict}`);
    return verdict;
  } finally {
    await client.end();
  }
}

/** The `listings.schools` jsonb keys; the only names interpolated into SQL below. */
const SCHOOL_KEYS = ["elementary", "middle", "high", "district"];

const allUpper = (v) => /[A-Z]/.test(v) && v === v.toUpperCase();

/**
 * All-uppercase, a word-start Mc/Mac/De/O' followed by a capital (McEver, DeKalb,
 * O'Neal) or Mc/Mac followed by a lowercase letter (Mcever, Macarthur), or an
 * all-capitals word of 2+ letters.
 */
const oddCasing = (v) =>
  allUpper(v) || /\b(?:Mc|Mac|De|O')[A-Z]|\b(?:Mc|Mac)[a-z]/.test(v) || /\b[A-Z]{2,}\b/.test(v);

/**
 * Read-only school/county coverage of the active Georgia sale listings, to size
 * a school filter. SELECTs only; values are trimmed before counting.
 */
async function schoolCoverage(client) {
  // Mirrors publicConditions + BUY_STATUSES + inMarketState (MARKET_STATE_SPELLINGS
  // in src/lib/state-name.ts).
  const market = `select l.source_id, l.schools, l.county from listings l
    where l.removed_at is null and not l.idx_hidden and l.transaction_type = 'sale'
      and l.status in ('active', 'coming_soon') and upper(btrim(l.state)) in ('GA', 'GEORGIA')`;
  const filled = (k) => `nullif(btrim(m.schools->>'${k}'), '') is not null`;
  const counts = await client.query(`with m as (${market})
    select grouping(ds.kind)::int as is_total, ds.kind, count(*)::int as total,
      count(*) filter (where ${SCHOOL_KEYS.slice(0, 3).map(filled).join(" or ")})::int as "anySchool",
      count(*) filter (where ${filled("high")})::int as high,
      count(*) filter (where ${filled("district")})::int as district,
      count(*) filter (where nullif(btrim(m.county), '') is not null)::int as county,
      count(distinct lower(nullif(btrim(m.county), '')))::int as "distinctCounties"
    from m left join data_sources ds on ds.id = m.source_id
    group by grouping sets ((ds.kind), ()) order by 1, 2`);
  const values = await client.query(
    `with m as (${market})
    select k.field, btrim(m.schools->>k.field) as raw,
      lower(regexp_replace(btrim(m.schools->>k.field), '\\s+', ' ', 'g')) as norm, count(*)::int as n
    from m cross join unnest($1::text[]) as k(field)
    where nullif(btrim(m.schools->>k.field), '') is not null
    group by 1, 2, 3 order by 1, 2`,
    [SCHOOL_KEYS],
  );
  const all = counts.rows.find((r) => r.is_total === 1);
  const result = {
    total: all.total,
    anySchool: all.anySchool,
    county: all.county,
    distinctCounties: all.distinctCounties,
  };
  for (const key of SCHOOL_KEYS) {
    const rows = values.rows.filter((r) => r.field === key);
    /** @type {Map<string, string[]>} */
    const spellings = new Map();
    for (const r of rows) spellings.set(r.norm, [...(spellings.get(r.norm) ?? []), r.raw]);
    result[key] = {
      filled: rows.reduce((sum, r) => sum + r.n, 0),
      distinctRaw: rows.length,
      distinctNormalized: spellings.size,
      top: [...rows].sort((a, b) => b.n - a.n).slice(0, 8).map((r) => [r.raw, r.n]),
      // All-uppercase values first; sort is stable, so the rest keep their order.
      casing: rows
        .map((r) => r.raw)
        .filter(oddCasing)
        .sort((a, b) => Number(allUpper(b)) - Number(allUpper(a)))
        .slice(0, 12),
      caseVariants: [...spellings].filter(([, s]) => s.length > 1).slice(0, 5),
    };
  }
  result.bySource = counts.rows
    .filter((r) => r.is_total === 0)
    .map(({ kind, total, anySchool, high, district }) => ({ kind, total, anySchool, high, district }));
  return result;
}

/**
 * Read-only report of the preview database's listings by data source, so the
 * build log shows whether any seed/demo listings are left. SELECTs only, and
 * only on the Neon preview branch; on the production branch it throws.
 * @param {string} connectionString
 * @param {(line: string) => void} [log]
 */
export async function previewListingCounts(connectionString, log = console.log) {
  const client = newBranchCheckClient(pg.Client, connectionString);
  await client.connect();
  try {
    const verdict = await branchVerdict(client, "Listing counts", log);
    if (verdict === "fatal") {
      throw new Error("Listing counts: connected to the production branch; refusing.");
    }
    if (verdict === "refuse") {
      log("Listing counts refused: not the Neon preview branch.");
      return;
    }
    const bySource = await client.query(`select ds.slug, ds.kind, ds.is_active,
        count(l.id)::int as listings
      from data_sources ds left join listings l on l.source_id = ds.id
      group by ds.id order by ds.slug`);
    const orphans = await client.query(`select count(*)::int as n
      from listings l left join data_sources ds on ds.id = l.source_id
      where ds.id is null`);
    const byOrigin = await client.query(`select ds.kind, l.from_feed,
        (l.mls_number is null) as no_mls_number, count(*)::int as listings
      from listings l left join data_sources ds on ds.id = l.source_id
      group by 1, 2, 3 order by 1, 2, 3`);
    const totals = await client.query(`select
      (select count(*)::int from listings) as listings,
      (select count(*)::int from listing_media) as listing_media`);
    log(
      `Preview listing counts: ${JSON.stringify({
        by_source: bySource.rows,
        without_source: orphans.rows[0].n,
        by_origin: byOrigin.rows,
        ...totals.rows[0],
      })}`,
    );
    try {
      log(`Preview school coverage: ${JSON.stringify(await schoolCoverage(client))}`);
    } catch (e) {
      log(`Preview school coverage failed: ${e instanceof Error ? e.message : e}`);
    }
  } finally {
    await client.end();
  }
}

/**
 * @param {string} connectionString
 * @param {(line: string) => void} [log]
 */
export async function purgePreviewListings(connectionString, log = console.log) {
  const client = newBranchCheckClient(pg.Client, connectionString);
  await client.connect();
  try {
    const verdict = await branchVerdict(client, "Preview purge", log);
    if (verdict === "fatal") {
      throw new Error("Preview purge: connected to the production branch; refusing and failing.");
    }
    if (verdict === "refuse") {
      log("Preview purge refused: not the Neon preview project and branch; nothing deleted.");
      return;
    }
    log(`Preview purge before: ${JSON.stringify(await counts(client))}`);
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM listings");
      await client.query("UPDATE data_sources SET is_active = false WHERE slug = any($1)", [
        SOURCE_SLUGS,
      ]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    log(`Preview purge after: ${JSON.stringify(await counts(client))}`);
  } finally {
    await client.end();
  }
}
