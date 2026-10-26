import { site } from "@/config/site";
import type { DataSourceConfig, dataSources } from "@/db/schema";

/**
 * Georgia MLS's IDX feed, served by Bridge Interactive's RESO Web API. The
 * seed (inactive) and `npm run mls:add-gamls` write this row; credentials come
 * from `MLS_GAMLS_TOKEN` (read by the provider through `credentialsEnvPrefix`).
 */

type Env = Record<string, string | undefined>;

export const GAMLS_ENV_PREFIX = "MLS_GAMLS";

/** The Bridge dataset name from MLS_GAMLS_DATASET; null when unset (no default). */
export function gamlsDataset(env: Env = process.env): string | null {
  return env.MLS_GAMLS_DATASET?.trim() || null;
}

export function gamlsBaseUrl(env: Env = process.env): string | undefined {
  const dataset = gamlsDataset(env);
  return dataset ? `https://api.bridgedataoutput.com/api/v2/OData/${dataset}` : undefined;
}

/** Limits the feed to one office's listings (MLS_GAMLS_OFFICE_ID); unset means the full IDX feed. */
function officeFilter(env: Env): string | undefined {
  const id = env.MLS_GAMLS_OFFICE_ID?.trim();
  return id ? `ListOfficeMlsId eq '${id.replaceAll("'", "''")}'` : undefined;
}

export function gamlsSource(
  env: Env = process.env,
): typeof dataSources.$inferInsert & { config: DataSourceConfig } {
  return {
    slug: "gamls",
    name: site.mls.name,
    kind: "reso_web_api",
    isActive: true,
    config: {
      baseUrl: gamlsBaseUrl(env),
      resource: "Property",
      filter: officeFilter(env),
      credentialsEnvPrefix: GAMLS_ENV_PREFIX,
      companyOfficeIds: [site.mls.officeId],
      // Bridge's documented $top cap; confirm with the probe.
      keyPageSize: 200,
      // Bridge returns Media inline and rejects $expand.
      expand: "",
    },
    disclaimer: site.mls.disclaimer,
  };
}
