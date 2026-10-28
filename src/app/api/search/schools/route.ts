import { NextResponse } from "next/server";
import { getSchoolOptions } from "@/lib/search/school-options";

export async function GET() {
  const options = await getSchoolOptions();
  return NextResponse.json(options, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
