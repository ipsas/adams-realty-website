import { and, asc, eq } from "drizzle-orm";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { ListingForm } from "@/components/dashboard/listing-form";
import { OpenHouseManager, type OpenHouseRow } from "@/components/dashboard/open-house-manager";
import { PageHeader } from "@/components/dashboard/ui";
import { buttonClasses } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { site } from "@/config/site";
import { db } from "@/db";
import { dataSources, listingMedia, listings, openHouses } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getAgentOptions } from "@/lib/dashboard/queries";
import { formatOpenHouse, formatShortOpenHouse, staffStatusLabel } from "@/lib/format";
import { isIdxHidden } from "@/lib/listings/visibility";
import { upcomingDays } from "@/lib/time";

export const metadata = { title: "Edit listing" };

const tz = site.market.timeZone;
const OFF_MARKET = new Set(["closed", "withdrawn", "expired", "canceled"]);

export default async function EditListingPage(props: PageProps<"/dashboard/listings/[id]">) {
  const { id } = await props.params;
  const { created } = await props.searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const actor = await requirePermission(`/dashboard/listings/${id}`, can.viewDashboard);

  const [row] = await db
    .select({ listing: listings, kind: dataSources.kind })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .where(eq(listings.id, id))
    .limit(1);
  if (!row) notFound();
  const l = row.listing;
  const subject = { sourceKind: row.kind, listAgentId: l.listAgentId };
  if (!can.editListing(actor, subject)) forbidden();

  const [photos, opens, agents] = await Promise.all([
    // The form edits photos; floor plans and other media are carried over by saveListing.
    db
      .select({ url: listingMedia.url, caption: listingMedia.caption })
      .from(listingMedia)
      .where(and(eq(listingMedia.listingId, id), eq(listingMedia.kind, "photo")))
      .orderBy(asc(listingMedia.sortOrder)),
    db
      .select()
      .from(openHouses)
      .where(eq(openHouses.listingId, id))
      .orderBy(asc(openHouses.startsAt)),
    getAgentOptions(),
  ]);

  const now = new Date();
  const rows = opens.map((o) => toRow(o, now));
  const upcoming = rows.filter((o) => o.phase !== "past");
  const past = rows.filter((o) => o.phase === "past").reverse();
  const nextDays = upcomingDays(7, now);
  const blocked = l.removedAt || OFF_MARKET.has(l.status);

  return (
    <>
      <PageHeader
        title={l.addressLine1}
        description={
          <>
            {staffStatusLabel(l.status, l.transactionType)} · {l.city}, {l.state} {l.postalCode} ·{" "}
            {isIdxHidden(l) ? (
              <span data-testid="not-public">Not on the public site in this status</span>
            ) : (
              <Link
                href={`/homes/${l.slug}`}
                className="font-medium text-brand-700 hover:underline"
              >
                View public page
              </Link>
            )}
          </>
        }
        action={
          <a
            href="#open-houses"
            className={buttonClasses("secondary", "md", "min-[1360px]:hidden")}
          >
            <CalendarDays />
            Open houses{upcoming.length > 0 && ` · ${upcoming.length} upcoming`}
          </a>
        }
      />
      {created && (
        <div className="mb-6">
          <FormMessage tone="success">
            Listing created. It shows on the public site in every status except Coming soon,
            Withdrawn, Expired and Canceled.
          </FormMessage>
        </div>
      )}
      {/* Open houses sit in a sidebar once there's room beside the form; below the form otherwise. */}
      <div className="grid grid-cols-1 gap-8 min-[1360px]:grid-cols-[minmax(0,1fr)_21rem] min-[1360px]:gap-10">
        <div className="min-w-0">
          <ListingForm
            values={{ ...l, photos }}
            agents={agents}
            canFeature={can.featureListing(actor)}
            canAssignAgent={actor.role === "admin"}
            canDelete={can.deleteListing(actor, subject)}
            upcomingOpenHouses={upcoming.length}
          />
        </div>
        <aside className="min-w-0 min-[1360px]:sticky min-[1360px]:top-24 min-[1360px]:max-h-[calc(100dvh-7rem)] min-[1360px]:self-start min-[1360px]:overflow-y-auto">
          <OpenHouseManager
            // A status change can cancel open houses on save; start fresh so an
            // earlier "Open house added" message doesn't linger beside an empty list.
            key={l.status}
            listingId={l.id}
            openHouses={[...upcoming, ...past]}
            // Default to the coming Saturday, the most common open house day.
            defaultDate={nextDays.find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6)!}
            minDate={new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now)}
            timeZoneLabel={timeZoneLabel(now)}
            blockedReason={
              blocked
                ? "This listing is sold or off market, so new open houses can't be scheduled. Change its status and save to add one."
                : null
            }
            showsCardBadge={l.status === "active" && !l.removedAt}
          />
        </aside>
      </div>
    </>
  );
}

function toRow(o: typeof openHouses.$inferSelect, now: Date): OpenHouseRow {
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(o.startsAt);
  const time = (d: Date) =>
    d
      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })
      .replace(":00", "");
  const start = time(o.startsAt);
  const end = time(o.endsAt);
  // "1 PM–3 PM" → "1–3 PM" when both are in the same half of the day.
  const meridiem = end.slice(-2);
  const range = start.endsWith(meridiem) ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`;
  return {
    id: o.id,
    type: o.type,
    remarks: o.remarks,
    label: formatOpenHouse(o.startsAt, o.endsAt),
    month: part({ month: "short" }),
    day: part({ day: "numeric" }),
    when: `${part({ weekday: "short" })} · ${range}`,
    badge: formatShortOpenHouse(o.startsAt),
    phase: o.endsAt <= now ? "past" : o.startsAt <= now ? "live" : "upcoming",
  };
}

/** "Eastern Time" for America/New_York; falls back to the zone name. */
function timeZoneLabel(at: Date) {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? tz
    );
  } catch {
    return tz;
  }
}
