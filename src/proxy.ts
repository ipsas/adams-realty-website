import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast, optimistic gate: bounce visitors with no session cookie to sign-in
 * before rendering account-only pages. This only checks that a cookie
 * exists — real authorization happens in each page and server action via
 * `src/lib/auth/session.ts` and `src/lib/auth/permissions.ts`.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*", "/saved/:path*", "/account/:path*"],
};
