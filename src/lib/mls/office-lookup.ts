import { and, eq, gte, isNull, notExists, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { listings, mlsOffices } from "@/db/schema";
import { UnexpectedResponseError } from "./reso/provider";
import type { MlsOffice } from "./types";

/**
 * Names the listing office of feed listings that arrive without a
 * ListOfficeName (gamls2 sends it empty). Once after a sync run (syncSource),
 * up to OFFICE_RUN_CAP office IDs of the source's listings that mls_offices
 * has no fresh entry for are looked up in the feed's Office resource,
 * OFFICE_CHUNK per request, and cached, IDs the feed doesn't know too (with a
 * null name, so they aren't asked for every run). listingOfficeLabel reads
 * the cache through officeLookupName() (src/lib/listings/card.ts).
 *
 * Best effort: it never throws. The first failure ends the step; the listing
 * shows "MLS Office ID <id>" meanwhile. One log line a run, which never holds
 * the URL, token, response body or error message.
 */

/** Office IDs looked up per run. */
export const OFFICE_RUN_CAP = 200;
/** Office IDs per Office request. */
export const OFFICE_CHUNK = 50;
/** A cached entry is looked up again after this long. */
export const OFFICE_FRESH_MS = 7 * 86_400_000;
/** The step only runs with at least this long left before the sync's deadline. */
export const OFFICE_MIN_REMAINING_MS = 20_000;

export type OfficeLookupDeps = {
  fetchOffices: (ids: string[]) => Promise<MlsOffice[]>;
  /** Up to `limit` office IDs needing a lookup (cached before `staleBefore`, or not at all). */
  officeIdsNeedingLookup: (limit: number, staleBefore: Date) => Promise<string[]>;
  /** Upserts the offices with updated_at = now(). */
  saveOffices: (offices: MlsOffice[]) => Promise<void>;
  log?: { info: (line: string) => void; warn: (line: string) => void };
  now?: () => number;
};

/** Never throws. Returns how many offices it saved with a name. */
export async function refreshOffices(deps: OfficeLookupDeps): Promise<number> {
  const log = deps.log ?? console;
  let requested = 0;
  let resolved = 0;
  let saved = 0;
  let phase: "db" | "fetch" = "db";
  try {
    const staleBefore = new Date((deps.now ?? Date.now)() - OFFICE_FRESH_MS);
    const ids = await deps.officeIdsNeedingLookup(OFFICE_RUN_CAP, staleBefore);
    if (!ids.length) {
      log.info("office_lookup: requested=0 resolved=0 status=skipped");
      return 0;
    }
    for (let i = 0; i < ids.length; i += OFFICE_CHUNK) {
      const chunk = ids.slice(i, i + OFFICE_CHUNK);
      requested += chunk.length;
      phase = "fetch";
      const found = new Map((await deps.fetchOffices(chunk)).map((o) => [o.officeMlsId, o]));
      phase = "db";
      const offices = chunk.map((id) => found.get(id) ?? { officeMlsId: id, officeName: null });
      const named = offices.filter((o) => o.officeName).length;
      resolved += named;
      await deps.saveOffices(offices);
      saved += named;
    }
    log.info(`office_lookup: requested=${requested} resolved=${resolved} status=200`);
  } catch (e) {
    const counts = `office_lookup: requested=${requested} resolved=${resolved}`;
    const status = (e as { status?: unknown } | null)?.status;
    if (phase === "fetch" && typeof status === "number") {
      log.warn(`${counts} status=${status} resource=Office`);
    } else {
      const reason =
        phase === "db" ? "db" : e instanceof UnexpectedResponseError ? "shape" : "timeout";
      log.warn(`${counts} status=error resource=Office reason=${reason}`);
    }
  }
  return saved;
}

/** The step's database side, for the source `sourceId`. */
export function officeLookupStore(
  db: Executor,
  sourceId: string,
): Pick<OfficeLookupDeps, "officeIdsNeedingLookup" | "saveOffices"> {
  return {
    async officeIdsNeedingLookup(limit, staleBefore) {
      const rows = await db
        .selectDistinct({ id: listings.listOfficeMlsId })
        .from(listings)
        .where(
          and(
            eq(listings.sourceId, sourceId),
            isNull(listings.removedAt),
            sql`coalesce(trim(${listings.listOfficeName}), '') = ''`,
            sql`coalesce(trim(${listings.listOfficeMlsId}), '') <> ''`,
            notExists(
              db
                .select({ one: sql`1` })
                .from(mlsOffices)
                .where(
                  and(
                    eq(mlsOffices.officeMlsId, listings.listOfficeMlsId),
                    gte(mlsOffices.updatedAt, staleBefore),
                  ),
                ),
            ),
          ),
        )
        .limit(limit);
      return rows.flatMap((r) => (r.id ? [r.id] : []));
    },
    async saveOffices(offices) {
      if (!offices.length) return;
      await db
        .insert(mlsOffices)
        .values(offices.map((o) => ({ ...o, updatedAt: sql`now()` })))
        .onConflictDoUpdate({
          target: mlsOffices.officeMlsId,
          set: { officeName: sql`excluded.office_name`, updatedAt: sql`now()` },
        });
    },
  };
}
