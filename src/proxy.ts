import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { clientIp, isListingDataPath, isScraperUserAgent, limitsFor } from "@/lib/anti-scraping";
import { hitRateLimits } from "@/lib/rate-limit-db";

/**
 * Two jobs, by path:
 *
 * - Listing data (search, listing pages, the location API): anti-scraping
 *   (src/lib/anti-scraping.ts). Self-declared HTTP libraries get a 403, and
 *   each client IP is rate limited in Postgres, so the limits hold across
 *   serverless instances. If the database can't be reached the request goes
 *   through: the limiter must never take the site down.
 * - Account pages: a fast, optimistic gate that bounces visitors with no
 *   session cookie to sign-in. It only checks that a cookie exists; real
 *   authorization happens in each page and server action via
 *   `src/lib/auth/session.ts` and `src/lib/auth/permissions.ts`.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (isListingDataPath(path)) return guardListingData(request, path);
  if (path.startsWith("/homes") || path.startsWith("/api/")) return NextResponse.next();

  if (getSessionCookie(request)) return NextResponse.next();
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

async function guardListingData(request: NextRequest, path: string) {
  if (isScraperUserAgent(request.headers.get("user-agent"))) {
    return new NextResponse(
      "Automated access to listing data isn't allowed. Listings are provided for consumers' personal use.",
      { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  const ip = clientIp(request.headers);
  if (!ip) return NextResponse.next();
  try {
    const result = await hitRateLimits(db, ip, limitsFor(path, request.headers));
    if (!result.ok) {
      return new NextResponse("Too many requests. Please wait a moment and try again.", {
        status: 429,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": String(result.retryAfter),
          "Cache-Control": "no-store",
        },
      });
    }
  } catch (e) {
    console.error("[proxy] rate limit check failed; letting the request through", e);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/saved/:path*",
    "/account/:path*",
    "/homes",
    "/homes/:path*",
    "/api/locations/:path*",
  ],
};
