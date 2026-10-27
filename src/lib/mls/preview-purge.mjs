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
