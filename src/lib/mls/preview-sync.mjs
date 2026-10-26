/**
 * Whether the Vercel build loads the Georgia MLS feed into the preview
 * database (scripts/vercel-build.mjs). Plain JS so the build runs it with node.
 * The reason names the missing condition, never a value.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldSyncFeed(env) {
  if (env.VERCEL_ENV !== "preview") return { run: false, reason: "not a preview build" };
  if (env.MLS_SYNC_ENABLED !== "true")
    return { run: false, reason: 'MLS_SYNC_ENABLED is not "true"' };
  if (!env.MLS_GAMLS_TOKEN) return { run: false, reason: "MLS_GAMLS_TOKEN is not set" };
  if (!env.MLS_GAMLS_DATASET) return { run: false, reason: "MLS_GAMLS_DATASET is not set" };
  return { run: true, reason: "preview build with MLS_SYNC_ENABLED, token and dataset set" };
}
