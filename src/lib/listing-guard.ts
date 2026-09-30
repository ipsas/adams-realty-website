import { NextResponse, type NextRequest } from "next/server";
import {
  claimedCrawler,
  clientIp,
  ipInList,
  isLoopback,
  isPreviewBot,
  isScraperUserAgent,
  limitPlan,
  normalizeIp,
  requestKind,
  type RequestKind,
  type SearchEngine,
  type Visitor,
} from "@/lib/anti-scraping";
import type { ProxyUser } from "@/lib/auth/proxy-session";
import { busyPageHtml } from "@/lib/busy-page";
import type { LimitResult, LimitWindow } from "@/lib/rate-limit-db";

/**
 * The anti-scraping guard `proxy.ts` runs on listing data (search, listing
 * pages, the location API). The policy is in ./anti-scraping.ts; this wires
 * it to the request, with its side effects (counting, session lookup, DNS)
 * passed in so tests can drive every branch.
 */

export type GuardDeps = {
  /** Counts `units` for `subject` against `windows` (rate-limit-db.ts in production). */
  hit(subject: string, windows: LimitWindow[], units: number): Promise<LimitResult>;
  /** The verified signed-in user, if any (auth/proxy-session.ts). */
  user(request: NextRequest): Promise<ProxyUser | null>;
  /** DNS-confirms a claimed search engine crawler (crawler-verify.ts). */
  verifyCrawler(ip: string, engine: SearchEngine): Promise<boolean>;
  /** The office's own addresses (`OFFICE_IPS`), never limited. */
  officeIps: readonly string[];
  /** Outside production, loopback requests (`next dev`, e2e runs) aren't limited. */
  production: boolean;
};

const REFUSED =
  "Automated access to listing data isn't allowed. Listings are provided for consumers' personal use.";

/** A response to send instead of the page, or null to let the request through. */
export async function guardListingData(
  request: NextRequest,
  deps: GuardDeps,
): Promise<NextResponse | null> {
  const path = request.nextUrl.pathname;
  const ua = request.headers.get("user-agent");
  const kind = requestKind(request.method, path, request.headers);
  // Link-preview robots may fetch pages (LinkedIn's names an HTTP library).
  const preview = kind === "page" && isPreviewBot(ua);
  if (!preview && isScraperUserAgent(ua)) {
    return new NextResponse(REFUSED, {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const raw = clientIp(request.headers);
  if (!raw) return null;
  const ip = normalizeIp(raw);

  const visitor = await identify(request, ip, ua, preview, deps);
  const plans = limitPlan(visitor, kind, ip);
  if (!plans.length) return null;
  try {
    const results = await Promise.all(plans.map((p) => deps.hit(p.subject, p.windows, p.units)));
    const over = results.filter((r) => !r.ok).sort((a, b) => b.retryAfter - a.retryAfter)[0];
    if (over) return tooMany(request, kind, over.retryAfter, visitor.kind === "member");
  } catch (e) {
    // The limiter must never take the site down.
    console.error("[proxy] rate limit check failed; letting the request through", e);
  }
  return null;
}

async function identify(
  request: NextRequest,
  ip: string,
  ua: string | null,
  preview: boolean,
  deps: GuardDeps,
): Promise<Visitor> {
  if (ipInList(ip, deps.officeIps)) return { kind: "exempt", why: "office" };
  if (!deps.production && isLoopback(ip)) return { kind: "exempt", why: "local" };
  const user = await deps.user(request).catch((e) => {
    console.error("[proxy] session lookup failed", e);
    return null;
  });
  if (user) {
    return user.role === "user"
      ? { kind: "member", userId: user.userId }
      : { kind: "exempt", why: "staff" };
  }
  const engine = claimedCrawler(ua);
  if (engine && (await deps.verifyCrawler(ip, engine).catch(() => false))) {
    return { kind: "exempt", why: "crawler" };
  }
  return preview ? { kind: "preview" } : { kind: "anonymous" };
}

function tooMany(request: NextRequest, kind: RequestKind, retryAfter: number, signedIn: boolean) {
  const headers = {
    "Retry-After": String(retryAfter),
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
  };
  // The API and prefetches: nobody reads these, so plain text.
  if (kind === "api" || kind === "prefetch") {
    return new NextResponse("Too many requests. Please wait a moment and try again.", {
      status: 429,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  // A page, or a client refresh: the router loads the URL as a page, which shows this too.
  const html = busyPageHtml({
    retryAfter,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    signedIn,
  });
  return new NextResponse(html, {
    status: 429,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}
