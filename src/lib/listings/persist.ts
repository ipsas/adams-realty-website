import { and, eq, getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { Executor } from "@/db";
import {
  listingEvents,
  listingMedia,
  listings,
  openHouses,
  type DataSourceConfig,
} from "@/db/schema";
import type { NormalizedListing, NormalizedMedia, NormalizedOpenHouse } from "@/lib/mls/types";
import { sanitizeNumeric } from "./sanitize";
import { listingSlug } from "./slug";
import { isIdxHidden } from "./visibility";

export type PersistSource = {
  id: string;
  slug: string;
  kind: "manual" | "reso_web_api";
  config: DataSourceConfig;
};

export type PersistOptions = {
  /** Resolves a feed's `ListAgentMlsId` to one of our agent profiles. */
  agentIdsByMlsId?: Map<string, string>;
  /** Explicit agent (manual listings). Wins over the MLS ID lookup. */
  listAgentId?: string | null;
  isFeatured?: boolean;
  now?: Date;
  /**
   * MLS sync: leave a record alone when its `sourceModifiedAt` equals the
   * stored row's (and nothing we derive from our own data changed), so a
   * re-fetched page costs one read and no writes.
   */
  skipUnchanged?: boolean;
};

export type UpsertResult = {
  id: string;
  created: boolean;
  /** False when `skipUnchanged` left the row untouched. */
  written: boolean;
  /** Rows written to listing_media and open_houses (deletes not counted). */
  mediaRowsWritten: number;
  /** Values of the listing (and its media) the sanitizer stored as null. */
  nulled: number;
};

type EventInsert = typeof listingEvents.$inferInsert;
type ListingInsert = typeof listings.$inferInsert;

// Postgres caps one statement at 65,535 bind parameters; stay well under it.
const MAX_PARAMS = 30_000;

/**
 * Writes one normalized listing — row, media, open houses and history events —
 * idempotently. Both the MLS sync and the manual-listing editor go through
 * here (the sync through its batch form, `upsertListings`, which is the one
 * implementation) so every listing is stored the same way regardless of origin.
 */
export async function upsertListing(
  tx: Executor,
  source: PersistSource,
  n: NormalizedListing,
  opts: PersistOptions = {},
): Promise<{ id: string; created: boolean }> {
  const [r] = await upsertListings(tx, source, [n], opts);
  return { id: r.id, created: r.created };
}

/**
 * The batch form of `upsertListing`: one read of the previous rows, one
 * multi-row upsert, one insert of history events, and media and open houses
 * rewritten only for listings whose lists actually changed. A page of 200 MLS
 * records costs about ten statements instead of six per listing. Results line
 * up with `items`; a key repeated within the batch is written once, with its
 * last occurrence.
 */
export async function upsertListings(
  tx: Executor,
  source: PersistSource,
  items: NormalizedListing[],
  opts: PersistOptions = {},
): Promise<UpsertResult[]> {
  if (!items.length) return [];
  const now = opts.now ?? new Date();
  const byKey = new Map<string, NormalizedListing>();
  const nulledByKey = new Map<string, number>();
  for (const n of items) {
    const { listing, nulled } = sanitizeListing(n);
    byKey.set(n.listingKey, listing);
    nulledByKey.set(n.listingKey, nulled);
  }
  const keys = [...byKey.keys()];

  const previousRows = await tx
    .select({
      id: listings.id,
      listingKey: listings.listingKey,
      listPrice: listings.listPrice,
      status: listings.status,
      removedAt: listings.removedAt,
      isFeatured: listings.isFeatured,
      sourceModifiedAt: listings.sourceModifiedAt,
      listAgentId: listings.listAgentId,
      isCompanyListing: listings.isCompanyListing,
      publicSince: listings.publicSince,
    })
    .from(listings)
    .where(and(eq(listings.sourceId, source.id), inArray(listings.listingKey, keys)));
  const previousByKey = new Map(previousRows.map((p) => [p.listingKey, p]));

  const results = new Map<string, UpsertResult>();
  const toWrite: Array<{ n: NormalizedListing; row: Omit<ListingInsert, "sourceId" | "slug"> }> =
    [];
  for (const n of byKey.values()) {
    const previous = previousByKey.get(n.listingKey);
    const { media, openHouses: opens, listAgentMlsId, ...fields } = n;
    void opens;
    const photos = media.filter((m) => m.kind === "photo");
    const listAgentId =
      opts.listAgentId !== undefined
        ? opts.listAgentId
        : listAgentMlsId
          ? (opts.agentIdsByMlsId?.get(listAgentMlsId) ?? null)
          : null;
    const fromFeed = source.kind !== "manual";
    const isCompanyListing =
      source.kind === "manual" ||
      (!!n.listOfficeMlsId && (source.config.companyOfficeIds ?? []).includes(n.listOfficeMlsId));

    if (
      opts.skipUnchanged &&
      previous &&
      !previous.removedAt &&
      n.sourceModifiedAt &&
      previous.sourceModifiedAt?.getTime() === n.sourceModifiedAt.getTime() &&
      previous.listAgentId === listAgentId &&
      previous.isCompanyListing === isCompanyListing &&
      (opts.isFeatured === undefined || opts.isFeatured === previous.isFeatured)
    ) {
      results.set(n.listingKey, {
        id: previous.id,
        created: false,
        written: false,
        mediaRowsWritten: 0,
        nulled: nulledByKey.get(n.listingKey)!,
      });
      continue;
    }

    toWrite.push({
      n,
      row: {
        ...fields,
        listAgentId,
        isCompanyListing,
        fromFeed,
        // First time the public could see it (a listing entering as Coming
        // Soon becomes public when it goes active).
        publicSince: previous?.publicSince ?? (isIdxHidden(fields) ? null : now),
        isFeatured: opts.isFeatured ?? previous?.isFeatured ?? false,
        primaryPhotoUrl: photos[0]?.url ?? null,
        photoCount: photos.length,
        statusChangedAt:
          fields.statusChangedAt ??
          (previous && previous.status !== fields.status ? now : undefined),
        removedAt: null,
      },
    });
  }

  if (toWrite.length) {
    // One statement per column set: a field left undefined must keep its
    // stored value (it isn't in that statement's SET), as a single upsert does.
    const groups = new Map<string, typeof toWrite>();
    for (const w of toWrite) {
      const signature = definedKeys(w.row).join(",");
      groups.set(signature, [...(groups.get(signature) ?? []), w]);
    }
    const saved = new Map<string, string>();
    for (const group of groups.values()) {
      const setKeys = definedKeys(group[0].row);
      const perRow = setKeys.length + 2;
      for (const batch of chunk(group, Math.max(1, Math.floor(MAX_PARAMS / perRow)))) {
        const rows = await tx
          .insert(listings)
          .values(
            batch.map(({ n, row }) => ({
              // Again for derived columns (photoCount). It only nulls: the column set holds.
              ...sanitizeNumeric(listings, row, listingLabel(n)),
              sourceId: source.id,
              slug: listingSlug({ ...n, sourceSlug: source.slug }),
            })),
          )
          .onConflictDoUpdate({
            target: [listings.sourceId, listings.listingKey],
            // Slug is deliberately not updated: URLs stay stable even if the address is corrected.
            set: { ...excludedSet(setKeys), updatedAt: now },
          })
          .returning({ id: listings.id, listingKey: listings.listingKey });
        for (const r of rows) saved.set(r.listingKey, r.id);
      }
    }

    const events: EventInsert[] = [];
    for (const { n } of toWrite) {
      const previous = previousByKey.get(n.listingKey);
      events.push(...diffEvents(saved.get(n.listingKey)!, previous ?? null, n, now));
    }
    for (const batch of chunk(events, 3_000)) await tx.insert(listingEvents).values(batch);

    // Media and open houses: rewritten only when the lists differ from what's stored.
    const existingIds = toWrite
      .map(({ n }) => previousByKey.get(n.listingKey)?.id)
      .filter((id): id is string => !!id);
    const [storedMedia, storedOpens] = existingIds.length
      ? await Promise.all([
          tx
            .select({
              listingId: listingMedia.listingId,
              sourceKey: listingMedia.sourceKey,
              url: listingMedia.url,
              kind: listingMedia.kind,
              caption: listingMedia.caption,
              width: listingMedia.width,
              height: listingMedia.height,
              sortOrder: listingMedia.sortOrder,
            })
            .from(listingMedia)
            .where(inArray(listingMedia.listingId, existingIds)),
          tx
            .select({
              listingId: openHouses.listingId,
              sourceKey: openHouses.sourceKey,
              type: openHouses.type,
              startsAt: openHouses.startsAt,
              endsAt: openHouses.endsAt,
              remarks: openHouses.remarks,
            })
            .from(openHouses)
            .where(inArray(openHouses.listingId, existingIds)),
        ])
      : [[], []];
    const mediaById = groupBy(storedMedia, (m) => m.listingId);
    const opensById = groupBy(storedOpens, (o) => o.listingId);

    const staleMedia: string[] = [];
    const mediaRows: (typeof listingMedia.$inferInsert)[] = [];
    const staleOpens: string[] = [];
    const opensRows: (typeof openHouses.$inferInsert)[] = [];
    for (const { n } of toWrite) {
      const id = saved.get(n.listingKey)!;
      const isNew = !previousByKey.has(n.listingKey);
      const mediaChanged =
        mediaSignature(isNew ? [] : (mediaById.get(id) ?? [])) !== mediaSignature(n.media);
      const opensChanged =
        openHouseSignature(isNew ? [] : (opensById.get(id) ?? [])) !==
        openHouseSignature(n.openHouses);
      if (mediaChanged) {
        if (!isNew) staleMedia.push(id);
        mediaRows.push(...n.media.map((m) => ({ ...m, listingId: id })));
      }
      if (opensChanged) {
        if (!isNew) staleOpens.push(id);
        opensRows.push(...n.openHouses.map((o) => ({ ...o, listingId: id })));
      }
      results.set(n.listingKey, {
        id,
        created: isNew,
        written: true,
        mediaRowsWritten:
          (mediaChanged ? n.media.length : 0) + (opensChanged ? n.openHouses.length : 0),
        nulled: nulledByKey.get(n.listingKey)!,
      });
    }
    if (staleMedia.length) {
      await tx.delete(listingMedia).where(inArray(listingMedia.listingId, staleMedia));
    }
    for (const batch of chunk(mediaRows, 3_000)) await tx.insert(listingMedia).values(batch);
    if (staleOpens.length) {
      await tx.delete(openHouses).where(inArray(openHouses.listingId, staleOpens));
    }
    for (const batch of chunk(opensRows, 3_000)) await tx.insert(openHouses).values(batch);
  }

  return items.map((n) => results.get(n.listingKey)!);
}

const listingColumns = getTableColumns(listings);

/** How logs name a listing: its key, and the public MLS number when it has one. */
export function listingLabel(n: Pick<NormalizedListing, "listingKey" | "mlsNumber">): string {
  return `listing ${n.listingKey}${n.mlsNumber ? ` (MLS ${n.mlsNumber})` : ""}`;
}

/**
 * The listing with values its numeric columns (and its media's) can't hold
 * nulled, so one bad feed value can't fail the batch (./sanitize.ts), and how
 * many values that was.
 */
export function sanitizeListing(n: NormalizedListing): {
  listing: NormalizedListing;
  nulled: number;
} {
  const label = listingLabel(n);
  let nulled = 0;
  // sanitizeNumeric warns once per value it nulls.
  const warn = (message: string) => {
    nulled++;
    console.warn(message);
  };
  const listing = {
    ...sanitizeNumeric(listings, n, label, warn),
    media: n.media.map((m) => sanitizeNumeric(listingMedia, m, label, warn)),
  };
  return { listing, nulled };
}

function definedKeys(row: object): string[] {
  return Object.entries(row)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
}

/** `SET col = excluded.col` for each field: the multi-row form of `set: row`. */
function excludedSet(keys: string[]): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const key of keys) {
    const column = listingColumns[key as keyof typeof listingColumns];
    if (!column) throw new Error(`upsertListings: unknown listing field "${key}"`);
    set[key] = sql`excluded.${sql.identifier(column.name)}`;
  }
  return set;
}

type MediaLike = Pick<
  NormalizedMedia,
  "sourceKey" | "url" | "kind" | "caption" | "width" | "height" | "sortOrder"
>;

/**
 * Fingerprint of a media list in display order (sortOrder, then URL for ties),
 * so the stored rows and a feed record compare equal when nothing changed.
 * Exported for tests.
 */
export function mediaSignature(media: MediaLike[]): string {
  return JSON.stringify(
    media
      .map((m) => [
        m.sortOrder,
        m.url,
        m.kind,
        m.sourceKey ?? null,
        m.caption ?? null,
        m.width ?? null,
        m.height ?? null,
      ])
      .sort(compareTuples),
  );
}

type OpenHouseLike = Pick<
  NormalizedOpenHouse,
  "sourceKey" | "type" | "startsAt" | "endsAt" | "remarks"
>;

/** Order-insensitive fingerprint of a listing's open houses. Exported for tests. */
export function openHouseSignature(opens: OpenHouseLike[]): string {
  return JSON.stringify(
    opens
      .map((o) => [
        o.startsAt.getTime(),
        o.endsAt.getTime(),
        o.type,
        o.sourceKey ?? null,
        o.remarks ?? null,
      ])
      .sort(compareTuples),
  );
}

type Scalar = string | number | null;

function compareTuples(a: Scalar[], b: Scalar[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

type PreviousState = {
  listPrice: number;
  status: NormalizedListing["status"];
  removedAt: Date | null;
};

/** History events implied by the change from `previous` to `next`. Exported for tests. */
export function diffEvents(
  listingId: string,
  previous: PreviousState | null,
  next: NormalizedListing,
  now: Date,
): EventInsert[] {
  const at = next.statusChangedAt ?? next.sourceModifiedAt ?? now;
  if (!previous) {
    const events: EventInsert[] = [
      {
        listingId,
        type: "listed",
        occurredAt: next.listDate ? new Date(`${next.listDate}T12:00:00Z`) : at,
        price: next.originalListPrice ?? next.listPrice,
        toStatus: next.status === "closed" ? "active" : next.status,
      },
    ];
    if (next.status === "closed") {
      events.push({
        listingId,
        type: "sold",
        occurredAt: next.closeDate ? new Date(`${next.closeDate}T12:00:00Z`) : at,
        price: next.closePrice ?? next.listPrice,
        toStatus: "closed",
      });
    }
    return events;
  }

  const events: EventInsert[] = [];
  if (previous.removedAt) {
    events.push({
      listingId,
      type: "relisted",
      occurredAt: at,
      price: next.listPrice,
      toStatus: next.status,
    });
  }
  if (previous.status !== next.status) {
    events.push({
      listingId,
      type: next.status === "closed" ? "sold" : "status_change",
      occurredAt: at,
      price: next.status === "closed" ? (next.closePrice ?? next.listPrice) : next.listPrice,
      fromStatus: previous.status,
      toStatus: next.status,
    });
  }
  if (previous.listPrice !== next.listPrice && next.status !== "closed") {
    events.push({
      listingId,
      type: "price_change",
      occurredAt: next.sourceModifiedAt ?? now,
      price: next.listPrice,
      previousPrice: previous.listPrice,
    });
  }
  return events;
}
