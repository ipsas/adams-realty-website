import { and, isNull, sql, type SQL } from "drizzle-orm";
import { listings } from "@/db/schema";
import { HIDDEN_STATUSES } from "./hidden-statuses";

/**
 * Georgia MLS IDX display rules (IDX/Vendor Data License Agreement, Aug 1 2023;
 * docs/plans/gamls-compliance.md), and the firm's own choice to follow the
 * status rule for every listing.
 *
 * - Exhibit A §17: no public display of Expired, Coming Soon, On Hold or
 *   Withdrawn listings. The mapper stores On Hold as `withdrawn` (the status
 *   enum has no on-hold value); Canceled is hidden too (a withdrawal by another
 *   name, and hiding more is safe). The firm hides its own manually entered
 *   listings in these statuses the same way, so this rule applies to every row.
 * - Exhibit A §16 and Exhibit C: Sold, On Hold, Withdrawn and Expired feed
 *   listings show the primary photo only, never a secondary one. The firm's
 *   own sold listings keep all their photos.
 * - A feed listing that left the feed (`removedAt`) is taken down, as the
 *   privacy page promises: no page, and saved homes show only that it's gone.
 *
 * Only public surfaces apply these; the dashboard shows staff every listing.
 */

type Status = (typeof listings.status.enumValues)[number];

/** Statuses the public never sees, for any listing. Mirrors the `idx_hidden` generated column. */
export const IDX_HIDDEN_STATUSES = HIDDEN_STATUSES satisfies readonly Status[];

/** Feed statuses shown with their primary photo only. */
export const PRIMARY_PHOTO_ONLY_STATUSES = [
  "closed",
  "withdrawn",
  "expired",
  "canceled",
] as const satisfies readonly Status[];

type Subject = { fromFeed: boolean; status: string; removedAt?: Date | null };

/** Whether the public may not see this listing at all. The same rule as `idx_hidden`. */
export function isIdxHidden(l: Pick<Subject, "status">): boolean {
  return (IDX_HIDDEN_STATUSES as readonly string[]).includes(l.status);
}

/**
 * Whether the listing's own page (and its details on a card) may be shown:
 * not for a hidden status, nor for a feed listing that left the feed.
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
 * Every public listing query's base condition: still listed, and not in a
 * hidden status. Keeps `removed_at is null` so the partial indexes'
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
