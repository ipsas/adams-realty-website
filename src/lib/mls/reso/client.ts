/**
 * Minimal RESO Web API (OData v4) client: bearer or OAuth2 client-credentials
 * auth, one page per request (the provider pages by keyset, never by
 * `@odata.nextLink`), and polite, bounded retry on 429/5xx, timeouts and
 * network errors.
 *
 * Every wait is bounded, so a sync can't hang on the feed: each request times
 * out, a Retry-After is capped, one page (with its retries) gives up after
 * MAX_PAGE_MS, and nothing is started or waited on past `deadline`. A page
 * therefore always ends, one way or the other, well inside the 300 s a
 * function has and the heartbeat window (STALE_RUN_MS) a CLI run is judged by.
 */

export type ResoClientConfig = {
  baseUrl: string;
  /** Static bearer token (Bridge, MLS Grid). */
  token?: string;
  /** OAuth2 client credentials (Trestle, Spark). */
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
  /** Epoch ms. No request is started, and no retry waited for, past this; one in flight is cut off at it. */
  deadline?: number;
  /** Default REQUEST_TIMEOUT_MS. */
  requestTimeoutMs?: number;
  /** Default MAX_RETRIES. */
  maxRetries?: number;
  /** Injected clock and sleep (tests). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type ODataPage<T> = { value: T[] };

/** One HTTP request. */
export const REQUEST_TIMEOUT_MS = 60_000;
/** One page, all its retries included. */
export const MAX_PAGE_MS = 120_000;
/** Longest wait between retries, whatever Retry-After asks for. */
export const MAX_RETRY_DELAY_MS = 30_000;
export const MAX_RETRIES = 5;

export class ResoClient {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: ResoClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    if (!config.token && !(config.clientId && config.clientSecret && config.tokenUrl)) {
      throw new Error("RESO client needs a token, or clientId + clientSecret + tokenUrl.");
    }
  }

  private timeout(limit: number): AbortSignal {
    const ms = Math.min(this.config.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, limit - this.now());
    return AbortSignal.timeout(Math.max(1, ms));
  }

  private async authHeader(limit: number): Promise<string> {
    if (this.config.token) return `Bearer ${this.config.token}`;
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return `Bearer ${this.accessToken.value}`;
    }
    const res = await this.fetchImpl(this.config.tokenUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.clientId!,
        client_secret: this.config.clientSecret!,
        scope: "api",
      }),
      signal: this.timeout(limit),
    });
    if (!res.ok) {
      const message = `RESO token request failed: ${res.status}`;
      // Bad credentials won't fix themselves; a busy or failing server might.
      throw res.status === 429 || res.status >= 500
        ? new Error(message)
        : new ResoHttpError(message, res.status);
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    this.accessToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return `Bearer ${json.access_token}`;
  }

  private async get<T>(url: string): Promise<ODataPage<T>> {
    const limit = Math.min(this.now() + MAX_PAGE_MS, this.config.deadline ?? Infinity);
    let lastProblem = "";
    let lastStatus: number | undefined;
    for (let attempt = 0; ; attempt++) {
      if (this.now() >= limit) {
        throw new Error(
          `RESO request gave up: out of time after ${attempt} attempt(s) for ${redact(url)}` +
            (lastProblem ? ` (last: ${lastProblem})` : ""),
        );
      }
      let retryAfter = NaN;
      try {
        const res = await this.fetchImpl(url, {
          headers: { Authorization: await this.authHeader(limit), Accept: "application/json" },
          signal: this.timeout(limit),
        });
        if (res.ok) return (await res.json()) as ODataPage<T>;
        if (res.status !== 429 && res.status < 500) {
          throw new ResoHttpError(
            `RESO request failed (${res.status}) for ${redact(url)}: ${await res.text()}`,
            res.status,
          );
        }
        lastProblem = `HTTP ${res.status}`;
        lastStatus = res.status;
        retryAfter = Number(res.headers.get("retry-after"));
      } catch (e) {
        if (e instanceof ResoHttpError) throw e;
        // A timeout (ours) or a network error: worth another try.
        lastProblem = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        lastStatus = undefined;
      }
      if (attempt >= (this.config.maxRetries ?? MAX_RETRIES)) {
        const message = `RESO request failed after ${attempt + 1} attempts for ${redact(url)}: ${lastProblem}`;
        throw lastStatus ? new ResoHttpError(message, lastStatus) : new Error(message);
      }
      const delay = Math.min(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000,
        MAX_RETRY_DELAY_MS,
      );
      if (this.now() + delay >= limit) {
        throw new Error(
          `RESO request gave up for ${redact(url)}: ${lastProblem}, and retrying would run past the time limit`,
        );
      }
      await this.sleep(delay);
    }
  }

  /** One page of `resource` matching the OData query options. */
  async getPage<T>(resource: string, query: Record<string, string>): Promise<T[]> {
    const base = this.config.baseUrl.replace(/\/$/, "");
    const page = await this.get<T>(`${base}/${resource}?${new URLSearchParams(query).toString()}`);
    return page.value;
  }
}

/** A response not worth retrying; `status` is its HTTP code. */
export class ResoHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function redact(url: string): string {
  return url.replace(/(access_token|token)=[^&]+/gi, "$1=***");
}
