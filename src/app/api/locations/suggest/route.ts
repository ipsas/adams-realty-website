import { NextResponse, type NextRequest } from "next/server";
import { getLocationSuggestions } from "@/lib/listings/queries";

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const suggestions = await getLocationSuggestions(q);
  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
