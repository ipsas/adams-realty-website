import type { DataSourceConfig } from "@/db/schema";
import type { ListingProvider, MapResult, PurgeScope } from "../types";
import { ResoClient } from "./client";
import { mapResoProperty, type ResoProperty } from "./mapper";

const PAGE_SIZE = 200;

/**
 * A listing feed served over the RESO Web API. Credentials come from env
 * vars named by `config.credentialsEnvPrefix` — e.g. prefix `MLS_ACTRIS`
 * reads `MLS_ACTRIS_TOKEN`, or `MLS_ACTRIS_CLIENT_ID` / `_CLIENT_SECRET`.
 */
export class ResoWebApiProvider implements ListingProvider {
  private readonly client: ResoClient;
  private readonly resource: string;
  private readonly baseFilter: string | undefined;

  constructor(config: DataSourceConfig, env: Record<string, string | undefined> = process.env) {
    if (!config.baseUrl) throw new Error("RESO data source is missing config.baseUrl");
    const prefix = config.credentialsEnvPrefix ?? "MLS";
    this.client = new ResoClient({
      baseUrl: config.baseUrl,
      token: env[`${prefix}_TOKEN`],
      clientId: env[`${prefix}_CLIENT_ID`],
      clientSecret: env[`${prefix}_CLIENT_SECRET`],
      tokenUrl: config.tokenUrl,
    });
    this.resource = config.resource ?? "Property";
    this.baseFilter = config.filter;
  }

  private filter(extra?: string): string | undefined {
    const parts = [this.baseFilter, extra].filter(Boolean).map((p) => `(${p})`);
    return parts.length ? parts.join(" and ") : undefined;
  }

  async *fetchUpdates(since: Date | null): AsyncIterable<MapResult[]> {
    // `ge` rather than `gt`: re-processing a boundary record is harmless (upserts
    // are idempotent), missing one that shares the cursor's timestamp is not.
    const filter = this.filter(
      since ? `ModificationTimestamp ge ${since.toISOString()}` : undefined,
    );
    const query: Record<string, string> = {
      $top: String(PAGE_SIZE),
      $orderby: "ModificationTimestamp asc",
      $expand: "Media,OpenHouse",
    };
    if (filter) query.$filter = filter;
    for await (const page of this.client.pages<ResoProperty>(this.resource, query)) {
      yield page.map(mapResoProperty);
    }
  }

  async *fetchActiveKeys(scope: PurgeScope): AsyncIterable<string[]> {
    const query: Record<string, string> = { $select: "ListingKey", $top: "1000" };
    const filter = this.filter(purgeScopeFilter(scope));
    if (filter) query.$filter = filter;
    for await (const page of this.client.pages<{ ListingKey: string }>(this.resource, query)) {
      yield page.map((row) => row.ListingKey);
    }
  }
}

/**
 * OData form of a PurgeScope, in the StandardStatus spelling the mapper reads
 * (`mapStatus`). `or` chains rather than `in`, which older OData 4.0 servers
 * reject. Exported for tests.
 */
export function purgeScopeFilter(scope: PurgeScope): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scope.closedSince)) {
    throw new Error(`purgeScopeFilter: closedSince must be YYYY-MM-DD, got "${scope.closedSince}"`);
  }
  const live = ["Active", "Active Under Contract", "Coming Soon", "Pending"]
    .map((s) => `StandardStatus eq '${s}'`)
    .join(" or ");
  return `${live} or (StandardStatus eq 'Closed' and CloseDate ge ${scope.closedSince})`;
}
