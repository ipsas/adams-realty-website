import { and, isNull, sql, type SQL } from "drizzle-orm";
import { listings } from "@/db/schema";

/**
 * Georgia MLS IDX display rules (IDX/Vendor Data License Agreement, Aug 1 2023;
 * docs/plans/gamls-compliance.md). They govern rows that came from the feed
 * (`fromFeed`); the firm's own manually entered listings are its own to show.
 *
 * - Exhibit A §17: no public display of Expired, Coming Soon, On Hold or
 *   Withdrawn listings. The mapper stores On Hold as `withdrawn`; Canceled is
 *   hidden too (it is a withdrawal by another name, and hiding more is safe).
 * - Exhibit A §16 and Exhibit C: Sold, On Hold, Withdrawn and Expired listings
 *   show the primary photo only, never a secondary one.
 * - A feed listing that left the feed (`removedAt`) is taken down, as the
 *   privacy page promises: no page, and saved homes show only that it's gone.
 */

type Status = (typeof listings.status.enumValues)[number];

/** Feed statuses the public never sees. Mirrors the `idx_hidden` generated column. */
export const IDX_HIDDEN_STATUSES = [
  "coming_soon",
  "withdrawn",
  "expired",
  "canceled",
] as const satisfies readonly Status[];

/** Feed statuses shown with their primary photo only. */
export const PRIMARY_PHOTO_ONLY_STATUSES = [
  "closed",
  "withdrawn",
  "expired",
  "canceled",
] as const satisfies readonly Status[];

type Subject = { fromFeed: boolean; status: string; removedAt?: Date | null };

/** Whether Georgia MLS rules forbid showing this row publicly. The same rule as `idx_hidden`. */
export function isIdxHidden(l: Pick<Subject, "fromFeed" | "status">): boolean {
  return l.fromFeed && (IDX_HIDDEN_STATUSES as readonly string[]).includes(l.status);
}

/**
 * Whether the listing's own page (and its details on a card) may be shown:
 * not for a hidden feed status, nor for a feed listing that left the feed.
 * The firm's own removed listings keep their "no longer on the market" page.
 */
export function canShowDetails(l: Subject): boolean {
  return !isIdxHidden(l) && !(l.fromFeed && l.removedAt);
}

/** Whether only the primary photo may be shown (sold or off-market feed listings). */
export function primaryPhotoOnly(l: Subject): boolean {
  return (
    l.fromFeed &&
    (!!l.removedAt || (PRIMARY_PHOTO_ONLY_STATUSES as readonly string[]).includes(l.status))
  );
}

/** Trims a photo list to what the rules allow for this listing. */
export function allowedPhotos<T>(l: Subject, photos: T[]): T[] {
  if (!canShowDetails(l)) return [];
  return primaryPhotoOnly(l) ? photos.slice(0, 1) : photos;
}

/**
 * Every public listing query's base condition: still listed, and not a feed
 * listing the rules hide. Keeps `removed_at is null` so the partial indexes'
 * predicates still apply.
 */
export function publicListing(): SQL {
  return and(...publicConditions())!;
}

/** `publicListing` as separate conditions, for callers that list their WHERE clauses one by one. */
export function publicConditions(): SQL[] {
  // A literal `not`, not `= $1`: no bind parameter, and the planner sees a constant.
  return [isNull(listings.removedAt), sql`not ${listings.idxHidden}`];
}
