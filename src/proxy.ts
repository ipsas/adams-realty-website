import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { isListingDataPath, parseIpList } from "@/lib/anti-scraping";
import { proxyUser } from "@/lib/auth/proxy-session";
import { crawlerVerifier } from "@/lib/crawler-verify";
import { DEMO_ROBOTS_HEADER, demoDataMode, isDemoContentPath } from "@/lib/demo-mode";
import { env } from "@/lib/env";
import { guardListingData, type GuardDeps } from "@/lib/listing-guard";
import { GATED_HEADERS, previewGate, previewPassword } from "@/lib/preview-gate";
import { hitRateLimits } from "@/lib/rate-limit-db";

/**
 * Runs on every request except Next's own files and a few public images (see
 * `config.matcher`). First the preview gate, then three jobs, by path:
 *
 * - Preview gate (src/lib/preview-gate.ts), only while PREVIEW_PASSWORD is set:
 *   visitors who haven't entered the password get the coming-soon page (page
 *   loads) or a 401 (everything else). No database: a cookie and an HMAC.
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
 *
 * The three jobs only act on their own paths (the listing paths, ACCOUNT_PATHS,
 * DEMO_CONTENT_PATHS); every other request passes through them untouched and
 * without a database call.
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
  const gate = await previewGate(request, previewPassword(), env.BETTER_AUTH_SECRET);
  if (gate.action === "redirect") {
    return gated(NextResponse.redirect(new URL(gate.location, request.url), 307));
  }
  if (gate.action === "deny") {
    return gated(
      new NextResponse("Preview access required.", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
  }
  const response = await route(request, path);
  if (demoDataMode() && isDemoContentPath(path)) {
    response.headers.set("X-Robots-Tag", DEMO_ROBOTS_HEADER);
  }
  return gate.action === "pass" ? gated(response) : response;
}

/** While the gate is on: never indexed, never cached by a CDN or shared cache. */
function gated(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(GATED_HEADERS)) response.headers.set(name, value);
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
    /*
     * Everything (pages, route handlers, RSC fetches, server actions), except:
     * - _next/: Next's own files (static chunks and fonts, the image optimizer, dev HMR);
     * - public files that hold no listing data: the favicon and app icon, the MLS logos
     *   (/brand), the team photos (/team) and the MapLibre worker (/vendor).
     */
    "/((?!_next/|favicon\\.ico$|icon\\.svg$|brand/|team/|vendor/).*)",
  ],
};
