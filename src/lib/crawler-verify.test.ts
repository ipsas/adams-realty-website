import { describe, expect, it, vi } from "vitest";
import { createCrawlerVerifier, type Resolver } from "./crawler-verify";

/** A DNS stand-in: PTR records by IP, A/AAAA records by host. */
function fakeDns(ptr: Record<string, string[]>, a: Record<string, string[]>) {
  const resolver: Resolver = {
    reverse: vi.fn(async (ip: string) => {
      if (!ptr[ip]) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return ptr[ip];
    }),
    lookup: vi.fn(async (host: string) => a[host] ?? []),
  };
  return resolver;
}

const GOOGLE_IP = "66.249.66.1";
const GOOGLE_HOST = "crawl-66-249-66-1.googlebot.com";

describe("crawler verification (reverse + forward DNS)", () => {
  it("confirms a real Googlebot: its PTR is in googlebot.com and resolves back to the IP", async () => {
    const dns = fakeDns({ [GOOGLE_IP]: [GOOGLE_HOST] }, { [GOOGLE_HOST]: [GOOGLE_IP] });
    const v = createCrawlerVerifier({ resolver: dns });
    expect(await v.verify(GOOGLE_IP, "google")).toBe(true);
    // Google is not Bing.
    expect(await v.verify(GOOGLE_IP, "bing")).toBe(false);
  });

  it("confirms Bingbot under search.msn.com", async () => {
    const ip = "157.55.39.1";
    const host = "msnbot-157-55-39-1.search.msn.com";
    const v = createCrawlerVerifier({ resolver: fakeDns({ [ip]: [host] }, { [host]: [ip] }) });
    expect(await v.verify(ip, "bing")).toBe(true);
  });

  it("refuses a PTR outside the engine's domain, even one that contains it", async () => {
    const ip = "203.0.113.9";
    const host = "crawl.googlebot.com.evil.example";
    const v = createCrawlerVerifier({ resolver: fakeDns({ [ip]: [host] }, { [host]: [ip] }) });
    expect(await v.verify(ip, "google")).toBe(false);
  });

  it("refuses a PTR that points at Google when Google's host doesn't resolve back (a forged PTR)", async () => {
    const ip = "203.0.113.9";
    const v = createCrawlerVerifier({
      resolver: fakeDns({ [ip]: [GOOGLE_HOST] }, { [GOOGLE_HOST]: [GOOGLE_IP] }),
    });
    expect(await v.verify(ip, "google")).toBe(false);
  });

  it("refuses an IP with no PTR record, and a DNS lookup that hangs", async () => {
    const v = createCrawlerVerifier({ resolver: fakeDns({}, {}) });
    expect(await v.verify("203.0.113.9", "google")).toBe(false);
    const hanging: Resolver = { reverse: () => new Promise(() => {}), lookup: async () => [] };
    const slow = createCrawlerVerifier({ resolver: hanging, timeoutMs: 20 });
    expect(await slow.verify(GOOGLE_IP, "google")).toBe(false);
  });

  it("caches answers per IP: a confirmed crawler costs two lookups a day, not two per page", async () => {
    let t = 0;
    const dns = fakeDns({ [GOOGLE_IP]: [GOOGLE_HOST] }, { [GOOGLE_HOST]: [GOOGLE_IP] });
    const v = createCrawlerVerifier({ resolver: dns, now: () => t });
    for (let i = 0; i < 5; i++) expect(await v.verify(GOOGLE_IP, "google")).toBe(true);
    expect(dns.reverse).toHaveBeenCalledTimes(1);
    expect(dns.lookup).toHaveBeenCalledTimes(1);
    t += 25 * 3_600_000; // a day later it checks again
    expect(await v.verify(GOOGLE_IP, "google")).toBe(true);
    expect(dns.reverse).toHaveBeenCalledTimes(2);
  });

  it("caches refusals too, for a shorter time", async () => {
    let t = 0;
    const dns = fakeDns({}, {});
    const v = createCrawlerVerifier({ resolver: dns, now: () => t });
    await v.verify("203.0.113.9", "google");
    await v.verify("203.0.113.9", "google");
    expect(dns.reverse).toHaveBeenCalledTimes(1);
    t += 6 * 60_000;
    await v.verify("203.0.113.9", "google");
    expect(dns.reverse).toHaveBeenCalledTimes(2);
  });
});
