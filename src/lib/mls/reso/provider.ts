import type { DataSourceConfig } from "@/db/schema";
import { liveStatusFilter } from "../gamls";
import type { FeedPosition, ListingProvider, MlsOffice, PurgeScope, UpdatesPage } from "../types";
import { ResoClient, type ResoClientConfig } from "./client";
import { mapResoProperty, RESO_MAPPER_VERSION, type ResoProperty } from "./mapper";

const PAGE_SIZE = 200;
const KEY_PAGE_SIZE = 1000;

export type ResoProviderOptions = Pick<ResoClientConfig, "deadline" | "fetchImpl" | "now" | "sleep">;

/** A feed source whose credential env vars aren't set (see `missingCredentials`). */
export class MissingCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingCredentialsError";
  }
}

/**
 * Null when the env holds credentials for `config` (`${prefix}_TOKEN`, or
 * `${prefix}_CLIENT_ID` + `_CLIENT_SECRET` with `config.tokenUrl`; empty
 * strings count as unset), else a message naming the variables to set.
 */
export function missingCredentials(
  config: DataSourceConfig,
  env: Record<string, string | undefined>,
): string | null {
  const prefix = config.credentialsEnvPrefix ?? "MLS";
  if (env[`${prefix}_TOKEN`]) return null;
  if (env[`${prefix}_CLIENT_ID`] && env[`${prefix}_CLIENT_SECRET`] && config.tokenUrl) return null;
  return `${prefix}_TOKEN is not set (or ${prefix}_CLIENT_ID + ${prefix}_CLIENT_SECRET with config.tokenUrl)`;
}

/**
 * A listing feed served over the RESO Web API. Credentials come from env
 * vars named by `config.credentialsEnvPrefix` — e.g. prefix `MLS_ACTRIS`
 * reads `MLS_ACTRIS_TOKEN`, or `MLS_ACTRIS_CLIENT_ID` / `_CLIENT_SECRET`.
 *
 * Both reads page by keyset: each request asks for the records after the
 * last one received, in a total order, and a run ends at the first empty
 * page. `@odata.nextLink` is not followed: servers commonly build it from
 * `$skip`, and when a record enters or leaves the result set between two
 * requests, every later record shifts by one and one of them is never seen.
 * For the purge that means removing a listing that is still for sale.
 */
export class ResoWebApiProvider implements ListingProvider {
  readonly mapperVersion = RESO_MAPPER_VERSION;
  private readonly client: ResoClient;
  private readonly officeClient: ResoClient;
  private readonly resource: string;
  private readonly baseFilter: string | undefined;
  private readonly keyPageSize: number;
  private readonly expand: string;

  constructor(
    config: DataSourceConfig,
    env: Record<string, string | undefined> = process.env,
    options: ResoProviderOptions = {},
  ) {
    if (!config.baseUrl) throw new Error("RESO data source is missing config.baseUrl");
    const missing = missingCredentials(config, env);
    if (missing) throw new MissingCredentialsError(missing);
    const prefix = config.credentialsEnvPrefix ?? "MLS";
    const clientConfig: ResoClientConfig = {
      baseUrl: config.baseUrl,
      token: env[`${prefix}_TOKEN`],
      clientId: env[`${prefix}_CLIENT_ID`],
      clientSecret: env[`${prefix}_CLIENT_SECRET`],
      tokenUrl: config.tokenUrl,
      ...options,
    };
    this.client = new ResoClient(clientConfig);
    this.officeClient = new ResoClient({
      ...clientConfig,
      requestTimeoutMs: OFFICE_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    this.resource = config.resource ?? "Property";
    this.baseFilter = config.filter;
    this.keyPageSize = config.keyPageSize ?? KEY_PAGE_SIZE;
    this.expand = config.expand ?? "Media,OpenHouse";
  }

  private filter(...extra: (string | undefined)[]): string | undefined {
    const parts = [this.baseFilter, ...extra].filter(Boolean).map((p) => `(${p})`);
    return parts.length ? parts.join(" and ") : undefined;
  }

  // TODO (design only): an optional rolling sold window for live-only feeds. A
  // config option such as `soldWindowDays` would add
  // `(StandardStatus eq 'Closed' and CloseDate ge <today − N days>)` here at
  // query time, like purgeScopeFilter does for the purge. Never write it into
  // the saved `config.filter`: the date changes daily, which would look like a
  // feed change and reset the cursor (feedChanged). The purge scope would then
  // keep closed rows whose closeDate falls inside the window.
  async *fetchUpdates(from: FeedPosition | null): AsyncIterable<UpdatesPage> {
    // The raw timestamp string, not a Date, marks the position between pages:
    // a feed with sub-millisecond timestamps would otherwise re-read (or, with
    // enough records in one millisecond, never get past) the page boundary.
    let position: RawPosition | null = from && {
      timestamp: from.modifiedAt.toISOString(),
      key: from.key,
    };
    for (;;) {
      const query: Record<string, string> = {
        $top: String(PAGE_SIZE),
        $orderby: "ModificationTimestamp asc,ListingKey asc",
      };
      if (this.expand) query.$expand = this.expand;
      const filter = this.filter(position ? updatesFilter(position) : undefined);
      if (filter) query.$filter = filter;
      const rows = await this.client.getPage<ResoProperty>(this.resource, query);
      if (!rows.length) return;
      const last = lastPosition(rows);
      yield {
        items: rows.map(mapResoProperty),
        last: last && { modifiedAt: new Date(last.timestamp), key: last.key },
      };
      if (!last) {
        throw new Error(
          "RESO feed returned a page with no ModificationTimestamp and ListingKey, so it can't be paged.",
        );
      }
      if (position && last.timestamp === position.timestamp && last.key === position.key) {
        throw new Error(`RESO feed isn't honoring the page filter (stuck after ${last.key}).`);
      }
      position = last;
    }
  }

  async *fetchActiveKeys(scope: PurgeScope): AsyncIterable<string[]> {
    let after: string | null = null;
    for (;;) {
      const query: Record<string, string> = {
        $select: "ListingKey",
        $top: String(this.keyPageSize),
        $orderby: "ListingKey asc",
      };
      const filter = this.filter(
        purgeScopeFilter(scope),
        after === null ? undefined : `ListingKey gt ${odataString(after)}`,
      );
      if (filter) query.$filter = filter;
      const rows = await this.client.getPage<{ ListingKey: string }>(this.resource, query);
      const keys = rows.map((row) => row.ListingKey).filter(Boolean);
      if (!keys.length) return;
      yield keys;
      const last = keys[keys.length - 1];
      if (last === after) {
        throw new Error(`RESO feed isn't honoring the page filter (stuck after ${last}).`);
      }
      after = last;
    }
  }

  /**
   * The Office resource of the same dataset (Bridge: `<baseUrl>/Office`), one
   * request for all of `ids` (callers chunk them). `or` chains rather than
   * `in`, as in purgeScopeFilter.
   */
  async fetchOffices(ids: string[]): Promise<MlsOffice[]> {
    if (!ids.length) return [];
    const rows = await this.officeClient.getPage<{ OfficeMlsId?: unknown; OfficeName?: unknown }>(
      "Office",
      {
        $filter: ids.map((id) => `OfficeMlsId eq ${odataString(id)}`).join(" or "),
        $select: "OfficeMlsId,OfficeName",
        $top: String(ids.length),
      },
    );
    if (!Array.isArray(rows)) throw new UnexpectedResponseError("Office");
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return rows.flatMap((r) => {
      const officeMlsId = text(r?.OfficeMlsId);
      return officeMlsId ? [{ officeMlsId, officeName: text(r.OfficeName) }] : [];
    });
  }
}

/** A feed response without the OData `value` array. */
export class UnexpectedResponseError extends Error {
  constructor(resource: string) {
    super(`RESO ${resource} response has no value array`);
    this.name = "UnexpectedResponseError";
  }
}

/** One Office request, no retries: office names mustn't hold up the sync. */
const OFFICE_REQUEST_TIMEOUT_MS = 10_000;

type RawPosition = { timestamp: string; key: string | null };

/** OData string literal: single quotes, doubled inside. */
function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The records at or after a timestamp (`key` null), or strictly after a
 * (timestamp, key) position in the feed's order. Exported for tests.
 */
export function updatesFilter({ timestamp, key }: RawPosition): string {
  if (!isTimestamp(timestamp)) {
    throw new Error(`updatesFilter: not a timestamp: "${timestamp}"`);
  }
  if (key === null) return `ModificationTimestamp ge ${timestamp}`;
  return (
    `ModificationTimestamp gt ${timestamp} or ` +
    `(ModificationTimestamp eq ${timestamp} and ListingKey gt ${odataString(key)})`
  );
}

/** An OData DateTimeOffset literal, as feeds send them (it goes into the next filter verbatim). */
function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** The last record on a page that has both a timestamp and a key. */
function lastPosition(rows: ResoProperty[]): { timestamp: string; key: string } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const { ModificationTimestamp: timestamp, ListingKey: key } = rows[i];
    if (isTimestamp(timestamp) && key) return { timestamp, key };
  }
  return null;
}

/**
 * OData form of a PurgeScope, in the StandardStatus spelling the mapper reads
 * (`mapStatus`). `or` chains rather than `in`, which older OData 4.0 servers
 * reject. A live-only scope asks for the live statuses alone. Exported for tests.
 */
export function purgeScopeFilter(scope: PurgeScope): string {
  if (scope.liveOnly) return liveStatusFilter();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scope.closedSince)) {
    throw new Error(`purgeScopeFilter: closedSince must be YYYY-MM-DD, got "${scope.closedSince}"`);
  }
  return `${liveStatusFilter()} or (StandardStatus eq 'Closed' and CloseDate ge ${scope.closedSince})`;
}
