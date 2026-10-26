import { site } from "@/config/site";
import type { DataSourceConfig, dataSources } from "@/db/schema";

/**
 * Georgia MLS's IDX feed, served by Bridge Interactive's RESO Web API. The
 * seed (inactive) and `npm run mls:add-gamls` write this row; credentials come
 * from `MLS_GAMLS_TOKEN` (read by the provider through `credentialsEnvPrefix`).
 */

type Env = Record<string, string | undefined>;

export const GAMLS_ENV_PREFIX = "MLS_GAMLS";

/** The data_sources slug of the Georgia MLS feed. */
export const GAMLS_SLUG = "gamls";

/**
 * The statuses the site shows for sale, in the RESO StandardStatus spelling
 * the mapper reads (`mapStatus`). The feed is limited to these, so closed and
 * off-market records never arrive.
 */
export const GAMLS_LIVE_STATUSES = ["Active", "Active Under Contract", "Coming Soon", "Pending"];

/** OData string literal: single quotes, doubled inside. */
function odataString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The live statuses as an `or` chain: no `in`, which older OData 4.0 servers reject. */
export function liveStatusFilter(): string {
  return GAMLS_LIVE_STATUSES.map((s) => `StandardStatus eq ${odataString(s)}`).join(" or ");
}

/** The Bridge dataset name from MLS_GAMLS_DATASET; null when unset (no default). */
export function gamlsDataset(env: Env = process.env): string | null {
  return env.MLS_GAMLS_DATASET?.trim() || null;
}

export function gamlsBaseUrl(env: Env = process.env): string | undefined {
  const dataset = gamlsDataset(env);
  return dataset ? `https://api.bridgedataoutput.com/api/v2/OData/${dataset}` : undefined;
}

export type GamlsScope = "statewide" | "area";

const SCOPES: readonly GamlsScope[] = ["statewide", "area"];

/** MLS_GAMLS_SCOPE, trimmed and lowercased; unset or empty means "statewide". */
export function gamlsScope(env: Env = process.env): GamlsScope {
  const raw = env.MLS_GAMLS_SCOPE?.trim().toLowerCase() || "statewide";
  if (!(SCOPES as readonly string[]).includes(raw)) {
    throw new Error(
      `MLS_GAMLS_SCOPE must be one of ${SCOPES.map((s) => `"${s}"`).join(", ")}, got "${env.MLS_GAMLS_SCOPE}"`,
    );
  }
  return raw as GamlsScope;
}

/**
 * The firm's area as an `or` chain: each county in `site.market.counties`,
 * plus Braselton and Hoschton, which straddle into Barrow County.
 */
function areaFilter(): string {
  return [
    ...site.market.counties.map((c) => `CountyOrParish eq ${odataString(c)}`),
    `(CountyOrParish eq 'Barrow' and (City eq 'Braselton' or City eq 'Hoschton'))`,
  ].join(" or ");
}

/**
 * The feed's saved OData filter, always limited to live statuses
 * (`liveStatusFilter`). MLS_GAMLS_SCOPE picks the geography and decides what
 * MLS_GAMLS_OFFICE_ID does:
 *   - "statewide" (default): every Georgia MLS listing; with an office ID, only
 *     that office's listings (the office ID narrows the feed).
 *   - "area": listings in the firm's counties (`site.market.counties`, plus
 *     Braselton and Hoschton in Barrow); with an office ID, also that office's
 *     listings anywhere, so the firm's own listings outside the area are kept
 *     (the office ID widens the feed).
 * Any other scope throws. A change here changes `config.filter`, so
 * `feedChanged` resets the cursor.
 */
export function gamlsFilter(env: Env = process.env): string {
  const scope = gamlsScope(env);
  const officeId = env.MLS_GAMLS_OFFICE_ID?.trim();
  const office = officeId ? `ListOfficeMlsId eq ${odataString(officeId)}` : undefined;
  const live = `(${liveStatusFilter()})`;
  if (scope === "area") {
    const area = office ? `${areaFilter()} or ${office}` : areaFilter();
    return `(${area}) and ${live}`;
  }
  return office ? `(${office}) and ${live}` : live;
}

/**
 * Whether the saved row pointed at a different feed (dataset, filter, or
 * live-only mode), so its sync cursor belongs to that feed and must be reset.
 * False with no row.
 */
export function feedChanged(
  prev: DataSourceConfig | null | undefined,
  next: DataSourceConfig,
): boolean {
  if (!prev) return false;
  return (
    prev.baseUrl !== next.baseUrl ||
    prev.filter !== next.filter ||
    (prev.liveOnly === true) !== (next.liveOnly === true)
  );
}

export function gamlsSource(
  env: Env = process.env,
): typeof dataSources.$inferInsert & { config: DataSourceConfig } {
  return {
    slug: GAMLS_SLUG,
    name: site.mls.name,
    kind: "reso_web_api",
    isActive: true,
    config: {
      baseUrl: gamlsBaseUrl(env),
      resource: "Property",
      filter: gamlsFilter(env),
      // The filter above already limits the feed to live statuses.
      liveOnly: true,
      credentialsEnvPrefix: GAMLS_ENV_PREFIX,
      companyOfficeIds: [site.mls.officeId],
      // Bridge's documented $top cap; confirm with the probe.
      keyPageSize: 200,
      // Bridge returns Media inline and rejects $expand.
      expand: "",
    },
    // For reference only: pages and emails show `mlsDisclaimer` (with the year and sync time),
    // never this column, for the gamls source.
    disclaimer: site.mls.disclaimer,
  };
}
