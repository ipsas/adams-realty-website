import { isCrawlerHost, normalizeIp, type SearchEngine } from "./anti-scraping";

/**
 * Confirms that a request claiming to be Googlebot or Bingbot really comes
 * from Google or Bing, the way both engines document: a reverse DNS lookup of
 * the IP must give a hostname in the engine's domain (`CRAWLER_DOMAINS`), and
 * a forward lookup of that hostname must give the same IP back. Anyone can
 * put "Googlebot" in a user agent; only Google controls those DNS records.
 *
 * Results are cached per IP and engine in memory (a day when confirmed, an
 * hour when not, a few minutes after a DNS failure), so a crawler costs two
 * lookups per serverless instance per day, not per page.
 */

export type Resolver = {
  reverse(ip: string): Promise<string[]>;
  lookup(host: string): Promise<string[]>;
};

const CONFIRMED_MS = 24 * 3_600_000;
const REFUSED_MS = 3_600_000;
const FAILED_MS = 5 * 60_000;
const TIMEOUT_MS = 1_500;
const MAX_ENTRIES = 5_000;

type Entry = { ok: boolean; until: number };

async function nodeResolver(): Promise<Resolver> {
  const dns = await import("node:dns/promises");
  return {
    reverse: (ip) => dns.reverse(ip),
    lookup: async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("DNS timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export function createCrawlerVerifier(
  opts: { resolver?: Resolver; now?: () => number; timeoutMs?: number } = {},
) {
  const cache = new Map<string, Entry>();
  const now = opts.now ?? Date.now;
  let resolver = opts.resolver;

  function remember(key: string, ok: boolean, ms: number) {
    if (cache.size >= MAX_ENTRIES) {
      const t = now();
      for (const [k, e] of cache) if (e.until <= t) cache.delete(k);
      // Still full: drop the oldest entries (Map keeps insertion order).
      for (const k of cache.keys()) {
        if (cache.size < MAX_ENTRIES) break;
        cache.delete(k);
      }
    }
    cache.set(key, { ok, until: now() + ms });
    return ok;
  }

  return {
    /** True only when DNS confirms `ip` belongs to `engine`'s crawlers. */
    async verify(ip: string, engine: SearchEngine): Promise<boolean> {
      const addr = normalizeIp(ip);
      const key = `${engine}:${addr}`;
      const hit = cache.get(key);
      if (hit && hit.until > now()) return hit.ok;
      resolver ??= await nodeResolver();
      const r = resolver;
      try {
        const hosts = await withTimeout(r.reverse(addr), opts.timeoutMs ?? TIMEOUT_MS);
        for (const host of hosts) {
          if (!isCrawlerHost(engine, host)) continue;
          const back = await withTimeout(r.lookup(host), opts.timeoutMs ?? TIMEOUT_MS);
          if (back.map(normalizeIp).includes(addr)) return remember(key, true, CONFIRMED_MS);
        }
        return remember(key, false, REFUSED_MS);
      } catch {
        // No PTR record, NXDOMAIN or a timeout: not confirmed. Retry sooner.
        return remember(key, false, FAILED_MS);
      }
    },
    /** For tests. */
    size: () => cache.size,
  };
}

/** The proxy's shared verifier. */
export const crawlerVerifier = createCrawlerVerifier();
