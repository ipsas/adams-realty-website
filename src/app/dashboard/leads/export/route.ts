import type { NextRequest } from "next/server";
import { site } from "@/config/site";
import { db } from "@/db";
import { can } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";
import { getLeadExportPage, isLeadStatus, type LeadExportCursor } from "@/lib/dashboard/queries";
import { env } from "@/lib/env";
import { formatFullAddress } from "@/lib/format";
import { audit } from "@/server/audit";
import { LEAD_SOURCE_LABELS, LEAD_TYPE_LABELS, TOUR_TYPE_LABELS } from "../[id]/lead-format";
import { CSV_BOM, csvDateTime, csvRow, exportFilename } from "./csv";

const PAGE_SIZE = 500;
const tz = site.market.timeZone;

const HEADERS = [
  `Received (${tz})`,
  "Status",
  "Type",
  "Name",
  "Email",
  "Phone",
  "Home",
  "Home link",
  `Tour time (${tz})`,
  "Tour format",
  "Assigned agent",
  "Came from",
  "Message",
  "Notes",
  "Latest note",
  "Lead link",
  "Lead ID",
];

type Row = Awaited<ReturnType<typeof getLeadExportPage>>[number];

function toCsv(r: Row): string {
  const home =
    r.listingAddressLine1 && r.listingCity && r.listingState && r.listingPostalCode
      ? formatFullAddress({
          addressLine1: r.listingAddressLine1,
          unitNumber: r.listingUnitNumber,
          city: r.listingCity,
          state: r.listingState,
          postalCode: r.listingPostalCode,
        })
      : null;
  return csvRow([
    csvDateTime(r.createdAt, tz),
    r.status,
    LEAD_TYPE_LABELS[r.type] ?? r.type,
    r.name,
    r.email,
    r.phone,
    home,
    r.listingSlug ? `${env.NEXT_PUBLIC_SITE_URL}/homes/${r.listingSlug}` : null,
    csvDateTime(r.tourAt, tz),
    r.tourType ? (TOUR_TYPE_LABELS[r.tourType] ?? r.tourType) : null,
    r.agentName ?? "Unassigned",
    LEAD_SOURCE_LABELS[r.source] ?? r.source,
    r.message,
    r.notesCount,
    r.latestNote,
    `${env.NEXT_PUBLIC_SITE_URL}/dashboard/leads/${r.id}`,
    r.id,
  ]);
}

/**
 * Leads as a CSV download, for admins (every lead is in scope). `?status=`
 * takes a lead status or `all`; anything else exports the open leads (new,
 * contacted, qualified), matching the Leads page's default tab. Rows stream in
 * pages, newest first, and each export is written to the audit log.
 */
export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return new Response("Please sign in.", { status: 401 });
  if (!can.viewAllInquiries(actor))
    return new Response("Only admins can export leads.", { status: 403 });

  const param = request.nextUrl.searchParams.get("status");
  const status = param === "all" || isLeadStatus(param) ? param : "open";

  await audit(db, {
    actorId: actor.userId,
    action: "inquiry.export",
    entityType: "inquiry",
    entityId: "*",
    changes: { status },
  });

  const encoder = new TextEncoder();
  let cursor: LeadExportCursor | null = null;
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(CSV_BOM + csvRow(HEADERS)));
        return;
      }
      try {
        const rows = await getLeadExportPage(actor, { status, after: cursor, limit: PAGE_SIZE });
        if (rows.length) controller.enqueue(encoder.encode(rows.map(toCsv).join("")));
        const last = rows.at(-1);
        if (!last || rows.length < PAGE_SIZE) controller.close();
        else cursor = { createdAt: last.cursor, id: last.id };
      } catch (e) {
        // Abort the download rather than hand over a silently truncated file.
        console.error("[leads export] failed", e);
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(site.name, status, new Date(), tz)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
