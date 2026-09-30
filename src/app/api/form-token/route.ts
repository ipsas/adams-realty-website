import { NextResponse } from "next/server";
import { formTokenSecret, issueFormToken } from "@/lib/form-token";

/**
 * A public form's timer token (src/lib/form-token.ts), fetched when the form opens
 * (`useFormTimer`). Never cached: each one records the moment it was asked for.
 */
export async function GET() {
  return NextResponse.json(
    { token: issueFormToken(formTokenSecret()) },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
