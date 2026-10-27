/**
 * Guards for the one-time preview purge in the Vercel build
 * (scripts/preview-purge.mjs). Plain JS so the build runs it with node.
 * Reasons name the condition, never a value.
 */

/** The Neon project and branch the preview deployments use. */
export const PREVIEW_PROJECT = "twilight-mouse-00683645";
export const PREVIEW_BRANCH = "br-bitter-leaf-b82hdmgq";
/** Production's branch: the purge must never touch it. */
export const PROD_BRANCH = "br-dark-dawn-b83x0l0x";

/**
 * pg client config for the branch checks, with no client-supplied startup
 * options: `-c neon.branch_id=...` in the URL's `options` parameter or in
 * PGOPTIONS would make SHOW report any branch. Removes the URL parameter; pg
 * falls back to process.env.PGOPTIONS whenever `options` is falsy, so the
 * client must be built with newBranchCheckClient, which also ignores it.
 * @param {string} connectionString
 * @returns {{ connectionString: string }}
 */
export function branchCheckConfig(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Branch check: the database URL is not a URL.");
  }
  url.searchParams.delete("options");
  return { connectionString: url.toString() };
}

/**
 * A pg client for the branch checks: branchCheckConfig, built while PGOPTIONS
 * is unset (pg reads it in the constructor), and refused if pg still resolved
 * startup options (e.g. from pg.defaults).
 * @template C
 * @param {new (config: { connectionString: string }) => C} Client
 * @param {string} connectionString
 * @returns {C}
 */
export function newBranchCheckClient(Client, connectionString) {
  const config = branchCheckConfig(connectionString);
  const saved = process.env.PGOPTIONS;
  delete process.env.PGOPTIONS;
  let client;
  try {
    client = new Client(config);
  } finally {
    if (saved !== undefined) process.env.PGOPTIONS = saved;
  }
  /** @type {{ connectionParameters?: { options?: unknown } }} */
  const resolved = /** @type {any} */ (client);
  if (resolved.connectionParameters?.options) {
    throw new Error("Branch check: pg resolved client startup options; refusing.");
  }
  return client;
}

/**
 * pg_settings sources a Neon id is trusted from: set on the server, which a
 * client or database owner cannot do. ALTER SYSTEM also yields "configuration
 * file" but needs superuser, which Neon does not give app roles. On Neon the
 * ids come from the configuration file; on vanilla Postgres neon.* are
 * placeholders with no pg_settings row, so an id set there (startup options,
 * SET, ALTER DATABASE / ROLE) is never trusted.
 */
export const TRUSTED_SETTING_SOURCES = ["configuration file", "command line"];

/**
 * @param {string | null | undefined} source pg_settings.source, or null if there is no row
 */
export function isTrustedSettingSource(source) {
  return source != null && TRUSTED_SETTING_SOURCES.includes(source);
}

/** @typedef {{ source: string | null, value: string | null }} NeonSetting */

/**
 * Which of the connection's Neon ids to trust. An id is kept only if its
 * pg_settings row has a trusted source and pg_db_role_setting holds no neon.*
 * entry (ALTER DATABASE / ALTER ROLE / ALTER ROLE IN DATABASE); an unreadable
 * count fails closed. Reasons name the condition, never a value.
 * @param {{
 *   settings: Record<string, NeonSetting | undefined>,
 *   roleSettings: number | null,
 * }} input settings by "neon.project_id"/"neon.branch_id"; roleSettings is the
 *   count of neon.* entries in pg_db_role_setting, or null if unreadable
 * @returns {{ projectId: string | null, branchId: string | null, reasons: string[] }}
 */
export function trustedNeonIds({ settings, roleSettings }) {
  /** @type {string[]} */
  const reasons = [];
  const roleOk = roleSettings === 0;
  if (roleSettings == null) reasons.push("neon.* role/database settings are unreadable");
  else if (!roleOk) reasons.push("neon.* role/database settings exist");
  /** @param {string} name */
  const id = (name) => {
    const source = settings[name]?.source ?? null;
    if (source == null) {
      reasons.push(`${name} has no pg_settings row`);
      return null;
    }
    if (!isTrustedSettingSource(source)) {
      reasons.push(`${name} comes from source "${source}"`);
      return null;
    }
    return roleOk ? settings[name]?.value || null : null;
  };
  const projectId = id("neon.project_id");
  const branchId = id("neon.branch_id");
  return { projectId, branchId, reasons };
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ run: boolean, reason: string }}
 */
export function purgeDecision(env) {
  if (env.VERCEL_ENV !== "preview") return { run: false, reason: "not a preview build" };
  if (env.MLS_PREVIEW_PURGE !== "true")
    return { run: false, reason: 'MLS_PREVIEW_PURGE is not "true"' };
  return { run: true, reason: "preview build with MLS_PREVIEW_PURGE" };
}

/**
 * @param {{ projectId?: string | null, branchId?: string | null }} ids
 * @returns {"ok" | "refuse" | "fatal"}
 */
export function checkBranch({ projectId, branchId }) {
  if (branchId === PROD_BRANCH) return "fatal";
  if (projectId === PREVIEW_PROJECT && branchId === PREVIEW_BRANCH) return "ok";
  return "refuse";
}

/**
 * May the Vercel build write to this database (migrations, purge, seed, sync,
 * keyword backfill)? Production builds only on the production branch, and any
 * other database fails the build (the current deployment keeps serving);
 * previews follow checkBranch; any other environment never writes.
 * @param {string | undefined} vercelEnv
 * @param {{ projectId?: string | null, branchId?: string | null }} ids
 * @returns {"ok" | "refuse" | "fatal"}
 */
export function buildDbDecision(vercelEnv, { projectId, branchId }) {
  if (vercelEnv === "production") return branchId === PROD_BRANCH ? "ok" : "fatal";
  if (vercelEnv === "preview") return checkBranch({ projectId, branchId });
  return "refuse";
}
