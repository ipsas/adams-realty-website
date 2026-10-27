import type { NextRequest } from "next/server";
import { site } from "@/config/site";
import { db } from "@/db";
import { can } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { listingOfficeLabel } from "@/lib/listings/office-label";
import { getListingViews, parseViewRange } from "@/lib/listings/views";
import { audit } from "@/server/audit";
import { CSV_BOM, csvRow } from "../../leads/export/csv";

const HEADERS = [
  "MLS number",
  "Address",
  "City",
  "Listing office",
  "Source",
  "Page views",
  "From",
  "To",
  "Listing link",
];

/**
 * Listing page views as CSV, for admins: the traffic statistics the Georgia
 * MLS IDX agreement (Exhibit A §9) asks us to make available. `?from=&to=`
 * are market dates (default: the last 30 days); `?feed=1` keeps only Georgia
 * MLS listings. Each export is written to the audit log.
 */
export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return new Response("Please sign in.", { status: 401 });
  if (!can.viewTrafficStats(actor))
    return new Response("Only admins can export traffic statistics.", { status: 403 });

  const params = request.nextUrl.searchParams;
  const range = parseViewRange({ from: params.get("from"), to: params.get("to") });
  const feedOnly = params.get("feed") === "1";
  await audit(db, {
    actorId: actor.userId,
    action: "listing_views.export",
    entityType: "listing_views",
    entityId: "*",
    changes: { ...range, feedOnly },
  });

  const rows = await getListingViews(db, range, { feedOnly });
  const body =
    CSV_BOM +
    csvRow(HEADERS) +
    rows
      .map((r) =>
        csvRow([
          r.mlsNumber,
          r.address,
          r.city,
          listingOfficeLabel(r, site),
          r.fromFeed ? site.mls.name : site.legalName,
          r.views,
          range.from,
          range.to,
          `${env.NEXT_PUBLIC_SITE_URL}/homes/${r.slug}`,
        ]),
      )
      .join("");
  const slug = site.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-listing-views-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
