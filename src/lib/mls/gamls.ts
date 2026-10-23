import { site } from "@/config/site";
import type { DataSourceConfig, dataSources } from "@/db/schema";

/**
 * Georgia MLS's IDX feed, served by Bridge Interactive's RESO Web API. The
 * seed (inactive) and `npm run mls:add-gamls` write this row; credentials come
 * from `MLS_GAMLS_TOKEN` (read by the provider through `credentialsEnvPrefix`).
 */

type Env = Record<string, string | undefined>;

/** PLACEHOLDER: the Bridge dataset name is unconfirmed until a token exists. Override with env MLS_GAMLS_DATASET. */
export const GAMLS_DATASET_DEFAULT = "gamls";

export const GAMLS_ENV_PREFIX = "MLS_GAMLS";

export function gamlsDataset(env: Env = process.env): string {
  return env.MLS_GAMLS_DATASET || GAMLS_DATASET_DEFAULT;
}

export function gamlsBaseUrl(env: Env = process.env): string {
  return `https://api.bridgedataoutput.com/api/v2/OData/${gamlsDataset(env)}`;
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
      credentialsEnvPrefix: GAMLS_ENV_PREFIX,
      companyOfficeIds: [site.mls.officeId],
      // Bridge's documented $top cap; confirm with the probe.
      keyPageSize: 200,
    },
    disclaimer: site.mls.disclaimer,
  };
}
