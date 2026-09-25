/**
 * Minimal RESO Web API (OData v4) client: bearer or OAuth2 client-credentials
 * auth, `@odata.nextLink` paging, and polite retry on 429/5xx.
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
};

type ODataPage<T> = { value: T[]; "@odata.nextLink"?: string };

export class ResoClient {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ResoClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    if (!config.token && !(config.clientId && config.clientSecret && config.tokenUrl)) {
      throw new Error("RESO client needs a token, or clientId + clientSecret + tokenUrl.");
    }
  }

  private async authHeader(): Promise<string> {
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
    });
    if (!res.ok) throw new Error(`RESO token request failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    this.accessToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return `Bearer ${json.access_token}`;
  }

  private async get<T>(url: string, attempt = 0): Promise<ODataPage<T>> {
    const res = await this.fetchImpl(url, {
      headers: { Authorization: await this.authHeader(), Accept: "application/json" },
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      await new Promise((r) => setTimeout(r, delay));
      return this.get<T>(url, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(
        `RESO request failed (${res.status}) for ${redact(url)}: ${await res.text()}`,
      );
    }
    return (await res.json()) as ODataPage<T>;
  }

  /** Iterates pages of `resource` matching the OData query options. */
  async *pages<T>(resource: string, query: Record<string, string>): AsyncGenerator<T[]> {
    const base = this.config.baseUrl.replace(/\/$/, "");
    let url: string | undefined = `${base}/${resource}?${new URLSearchParams(query).toString()}`;
    while (url) {
      const page: ODataPage<T> = await this.get<T>(url);
      if (page.value.length) yield page.value;
      url = page["@odata.nextLink"];
    }
  }
}

function redact(url: string): string {
  return url.replace(/(access_token|token)=[^&]+/gi, "$1=***");
}
