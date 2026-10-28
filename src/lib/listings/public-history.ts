import type { listingEvents } from "@/db/schema";

type ListingEvent = typeof listingEvents.$inferSelect;

/** A history row as the property page gets it: a feed listing's carry no date. */
export type PublicEvent = Pick<
  ListingEvent,
  "id" | "type" | "price" | "previousPrice" | "fromStatus" | "toStatus"
> & { occurredAt?: Date };

/**
 * A listing's price and status history for the public page, from its events newest first.
 * A feed listing's events lose their dates: the "listed" one was once dated by the list date
 * (the OnMarketDate Georgia MLS Exhibit C keeps off the site), and older rows still are, so
 * no feed event date leaves the server. Undated, the order tells the story: newest first,
 * with the first "listed" event always last, so a home first seen already sold still reads
 * Listed below Sold. A manual listing's history is staff-entered and keeps its dates.
 */
export function publicHistory(events: ListingEvent[], fromFeed: boolean): PublicEvent[] {
  if (!fromFeed) return events;
  const ordered = [...events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const first = ordered.findLastIndex((e) => e.type === "listed");
  if (first >= 0) ordered.push(...ordered.splice(first, 1));
  return ordered.map((e) => ({
    id: e.id,
    type: e.type,
    price: e.price,
    previousPrice: e.previousPrice,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
  }));
}
