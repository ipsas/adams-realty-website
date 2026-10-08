import { NextResponse, type NextRequest } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/alerts/token";
import { unsubscribe } from "@/lib/alerts/unsubscribe";

/**
 * RFC 8058 one-click unsubscribe. Alert emails carry
 * `List-Unsubscribe: <…/alerts/one-click?token=…>` with
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and mail apps POST
 * here when someone taps their built-in "Unsubscribe" button. The signed
 * token is the authorization (see src/lib/alerts/token.ts).
 */
export async function POST(request: NextRequest) {
  const target = verifyUnsubscribeToken(request.nextUrl.searchParams.get("token"));
  if (!target) {
    return new NextResponse("This unsubscribe link is invalid or has expired.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  await unsubscribe(target);
  return new NextResponse("You're unsubscribed.", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** A GET never changes anything (link scanners fetch URLs); send people to the confirm page. */
export function GET(request: NextRequest) {
  const url = new URL("/alerts/unsubscribe", request.nextUrl);
  const token = request.nextUrl.searchParams.get("token");
  if (token) url.searchParams.set("token", token);
  return NextResponse.redirect(url, 303);
}
