import { and, eq } from "drizzle-orm";
import type { Executor } from "@/db";
import {
  listingEvents,
  listingMedia,
  listings,
  openHouses,
  type DataSourceConfig,
} from "@/db/schema";
import type { NormalizedListing } from "@/lib/mls/types";
import { listingSlug } from "./slug";

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
};

type EventInsert = typeof listingEvents.$inferInsert;

/**
 * Writes one normalized listing — row, media, open houses and history events —
 * idempotently. Both the MLS sync and the manual-listing editor go through
 * here so every listing is stored the same way regardless of origin.
 */
export async function upsertListing(
  tx: Executor,
  source: PersistSource,
  n: NormalizedListing,
  opts: PersistOptions = {},
): Promise<{ id: string; created: boolean }> {
  const now = opts.now ?? new Date();
  const [previous] = await tx
    .select({
      id: listings.id,
      listPrice: listings.listPrice,
      status: listings.status,
      removedAt: listings.removedAt,
      isFeatured: listings.isFeatured,
    })
    .from(listings)
    .where(and(eq(listings.sourceId, source.id), eq(listings.listingKey, n.listingKey)))
    .limit(1);

  const { media, openHouses: opens, listAgentMlsId, ...fields } = n;
  const photos = media.filter((m) => m.kind === "photo");
  const listAgentId =
    opts.listAgentId !== undefined
      ? opts.listAgentId
      : listAgentMlsId
        ? (opts.agentIdsByMlsId?.get(listAgentMlsId) ?? null)
        : null;
  const isCompanyListing =
    source.kind === "manual" ||
    (!!n.listOfficeMlsId && (source.config.companyOfficeIds ?? []).includes(n.listOfficeMlsId));

  const row = {
    ...fields,
    listAgentId,
    isCompanyListing,
    isFeatured: opts.isFeatured ?? previous?.isFeatured ?? false,
    primaryPhotoUrl: photos[0]?.url ?? null,
    photoCount: photos.length,
    statusChangedAt:
      fields.statusChangedAt ?? (previous && previous.status !== fields.status ? now : undefined),
    removedAt: null,
  };

  const [saved] = await tx
    .insert(listings)
    .values({
      ...row,
      sourceId: source.id,
      slug: listingSlug({ ...n, sourceSlug: source.slug }),
    })
    .onConflictDoUpdate({
      target: [listings.sourceId, listings.listingKey],
      // Slug is deliberately not updated: URLs stay stable even if the address is corrected.
      set: { ...row, updatedAt: now },
    })
    .returning({ id: listings.id });

  const events = diffEvents(saved.id, previous ?? null, n, now);
  if (events.length) await tx.insert(listingEvents).values(events);

  await tx.delete(listingMedia).where(eq(listingMedia.listingId, saved.id));
  if (media.length) {
    await tx.insert(listingMedia).values(media.map((m) => ({ ...m, listingId: saved.id })));
  }

  await tx.delete(openHouses).where(eq(openHouses.listingId, saved.id));
  if (opens.length) {
    await tx.insert(openHouses).values(opens.map((o) => ({ ...o, listingId: saved.id })));
  }

  return { id: saved.id, created: !previous };
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
