import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { isListingDataPath, parseIpList } from "@/lib/anti-scraping";
import { proxyUser } from "@/lib/auth/proxy-session";
import { crawlerVerifier } from "@/lib/crawler-verify";
import { DEMO_ROBOTS_HEADER, demoDataMode, isDemoContentPath } from "@/lib/demo-mode";
import { env } from "@/lib/env";
import { guardListingData, type GuardDeps } from "@/lib/listing-guard";
import { hitRateLimits } from "@/lib/rate-limit-db";

/**
 * Three jobs, by path:
 *
 * - Listing data (search, listing pages, the location API): anti-scraping
 *   (src/lib/listing-guard.ts, policy in src/lib/anti-scraping.ts).
 *   Self-declared HTTP libraries get a 403; each client IP (or signed-in
 *   buyer) is rate limited in Postgres, so the limits hold across serverless
 *   instances, and gets a branded 429 page when over. Staff, the office's
 *   addresses and DNS-verified Google/Bing crawlers aren't limited. If the
 *   database can't be reached the request goes through: the limiter must
 *   never take the site down.
 * - Account pages: a fast, optimistic gate that bounces visitors with no
 *   session cookie to sign-in. It only checks that a cookie exists; real
 *   authorization happens in each page and server action via
 *   `src/lib/auth/session.ts` and `src/lib/auth/permissions.ts`.
 * - Demo-data mode (src/lib/demo-mode.ts): `X-Robots-Tag: noindex` on the
 *   pages that show sample data.
 */

const deps: GuardDeps = {
  hit: (subject, windows, units) => hitRateLimits(db, subject, windows, new Date(), units),
  user: (request) => proxyUser(request, db, env.BETTER_AUTH_SECRET),
  verifyCrawler: (ip, engine) => crawlerVerifier.verify(ip, engine),
  officeIps: parseIpList(env.OFFICE_IPS),
  production: process.env.NODE_ENV === "production",
};

const ACCOUNT_PATHS = ["/dashboard", "/saved", "/account"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const response = await route(request, path);
  if (demoDataMode() && isDemoContentPath(path)) {
    response.headers.set("X-Robots-Tag", DEMO_ROBOTS_HEADER);
  }
  return response;
}

async function route(request: NextRequest, path: string): Promise<NextResponse> {
  if (isListingDataPath(path))
    return (await guardListingData(request, deps)) ?? NextResponse.next();
  const account = ACCOUNT_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (!account || getSessionCookie(request)) return NextResponse.next();
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/saved/:path*",
    "/account/:path*",
    "/homes",
    "/homes/:path*",
    "/api/locations/:path*",
    // Demo-data mode's noindex header (the listing pages are above).
    "/areas/:path*",
    "/places/:path*",
    "/agents/:path*",
  ],
};
