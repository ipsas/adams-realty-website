import type { Client } from "pg";
import { FIXTURE_PHOTO_HOST } from "../../src/config/images";

/*
 * Points listings' photos at the fake MLS photo host (photo-host.mjs) and back, for
 * e2e/photos-suite.ts and scripts/perf/photo-weight.ts. Each photo gets its own URL,
 * `<host>/mls/<listing_media.id>.jpg`, so a request can be traced to its listing and place.
 */

export type MovedPhoto = {
  id: string;
  listingId: string;
  /** 1 for the listing's first photo, 2 for the second, … */
  rank: number;
  url: string;
  original: string;
};

export type MovedPhotos = {
  photos: MovedPhoto[];
  primary: { id: string; url: string | null }[];
};

export const fixturePhotoUrl = (mediaId: string, host = FIXTURE_PHOTO_HOST) =>
  `${host}/mls/${mediaId}.jpg`;

/** The listing_media id in a fake-host URL, or in an optimizer URL for one. */
export function fixtureMediaId(url: string): string | null {
  let src = url;
  try {
    const u = new URL(url);
    if (u.pathname === "/_next/image") src = u.searchParams.get("url") ?? "";
  } catch {
    return null;
  }
  return /\/mls\/([0-9a-f-]{36})\.jpg$/.exec(src)?.[1] ?? null;
}

export async function moveToPhotoHost(
  db: Client,
  listingIds: string[],
  host = FIXTURE_PHOTO_HOST,
): Promise<MovedPhotos> {
  const { rows } = await db.query<{
    id: string;
    listingId: string;
    rank: string;
    original: string;
  }>(
    `select id, listing_id as "listingId", url as original,
            row_number() over (partition by listing_id order by sort_order, id) as rank
       from listing_media where listing_id = any($1) and kind = 'photo'`,
    [listingIds],
  );
  const primary = await db.query<{ id: string; url: string | null }>(
    `select id, primary_photo_url as url from listings where id = any($1)`,
    [listingIds],
  );
  await db.query(
    `update listing_media set url = $2 || '/mls/' || id || '.jpg'
      where listing_id = any($1) and kind = 'photo'`,
    [listingIds, host],
  );
  await db.query(
    `update listings l set primary_photo_url = (select m.url from listing_media m
       where m.listing_id = l.id and m.kind = 'photo' order by m.sort_order, m.id limit 1)
     where l.id = any($1)`,
    [listingIds],
  );
  return {
    photos: rows.map((r) => ({
      ...r,
      rank: Number(r.rank),
      url: fixturePhotoUrl(r.id, host),
    })),
    primary: primary.rows,
  };
}

export async function restorePhotos(db: Client, moved: MovedPhotos): Promise<void> {
  for (const p of moved.photos)
    await db.query(`update listing_media set url = $2 where id = $1`, [p.id, p.original]);
  for (const l of moved.primary)
    await db.query(`update listings set primary_photo_url = $2 where id = $1`, [l.id, l.url]);
}
