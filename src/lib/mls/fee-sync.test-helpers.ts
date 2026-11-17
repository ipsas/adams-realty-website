/**
 * A minimal in-memory SyncStore and feed for the HOA fee sync tests
 * (fee-heal.fees.test.ts, fee-audit-run.fees.test.ts): it records what the engine
 * asks of it, with no database. sync-engine.test.ts has the full MemoryStore.
 */
import { emptyFeeAudit, type FeeAudit } from "@/lib/listings/fee-audit";
import type { FeeCheck } from "./reso/fee-check";
import type { PageOutcome, RunOutcome, SyncCursor, SyncMode, SyncStore } from "./sync-engine";
import type { ListingProvider, MapResult, OwnClosedFeed, UpdatesPage } from "./types";

export const START = Date.parse("2026-11-17T09:00:00Z");

export function record(key: string, i = 0): MapResult {
  return {
    ok: true,
    listing: {
      listingKey: key,
      status: "active",
      propertyType: "single_family",
      listPrice: 300_000,
      addressLine1: `${i} Main St`,
      city: "Athens",
      state: "GA",
      postalCode: "30601",
      listAgentMlsId: null,
      sourceModifiedAt: new Date(START - 86_400_000 + i * 1000),
      hoaFee: 600,
      hoaFrequency: "annually",
      media: [],
      openHouses: [],
    },
  };
}

export function pageOf(items: MapResult[], feeCheck?: FeeCheck): UpdatesPage {
  const last = items[items.length - 1];
  return {
    items,
    last: last?.ok
      ? { modifiedAt: last.listing.sourceModifiedAt!, key: last.listing.listingKey }
      : null,
    ...(feeCheck ? { feeCheck } : {}),
  };
}

export type Write = { keys: string[]; cursor: SyncCursor | null; skipUnchanged: boolean };

export class FakeStore implements SyncStore {
  readonly slug = "gamls";
  cursor: SyncCursor | null = null;
  versions = { done: 5 as number | null, remappingTo: null as number | null };
  ownSyncedAt: Date | null = null;
  writes: Write[] = [];
  finished: RunOutcome[] = [];
  staleCalls: number[] = [];
  /** What staleFeeKeys returns, call by call (the last answer repeats). */
  staleAnswers: string[][] = [[]];
  audit: () => Promise<FeeAudit> = async () => emptyFeeAudit();
  auditCalls = 0;

  async beginRun(mode: SyncMode) {
    void mode;
    return { runId: "run-1", staleFailed: 0 };
  }
  async recordSkipped() {}
  async savedCursor() {
    return this.cursor;
  }
  async mapperVersions() {
    return { ...this.versions };
  }
  async rejectionStreak() {
    return null;
  }
  async recordRejection(at: SyncCursor | null) {
    return { at, failures: 1 };
  }
  async quarantinedVersions() {
    return new Map<string, Date | null>();
  }
  async ownClosedSyncedAt() {
    return this.ownSyncedAt;
  }
  async recordOwnClosedSynced(at: Date) {
    this.ownSyncedAt = at;
  }
  async staleFeeKeys(limit: number) {
    this.staleCalls.push(limit);
    const i = Math.min(this.staleCalls.length - 1, this.staleAnswers.length - 1);
    return this.staleAnswers[i];
  }
  async auditFees() {
    this.auditCalls++;
    return this.audit();
  }
  async writePage(
    page: MapResult[],
    cursor: SyncCursor | null,
    { skipUnchanged }: { skipUnchanged: boolean },
  ): Promise<PageOutcome> {
    const keys = page.flatMap((item) => (item.ok ? [item.listing.listingKey] : []));
    this.writes.push({ keys, cursor, skipUnchanged });
    if (cursor) this.cursor = cursor;
    return {
      upserted: keys.length,
      unchanged: 0,
      removed: 0,
      failed: 0,
      mediaRowsWritten: 0,
      nulled: 0,
      quarantined: 0,
    };
  }
  async heartbeat() {}
  async countPurge(feedKeys: string[]) {
    return { inScope: feedKeys.length, missing: 0 };
  }
  async purge() {
    return 0;
  }
  async pruneRemoved() {
    return 0;
  }
  async finishRun(_runId: string, outcome: RunOutcome) {
    this.finished.push(outcome);
  }
}

/** A feed of `records` in one page (its fee check `feeCheck`), with optional fetchByKeys and own sales. */
export function fakeFeed(
  records: MapResult[],
  opts: {
    feeCheck?: FeeCheck;
    byKeys?: (keys: string[]) => AsyncIterable<UpdatesPage>;
    own?: MapResult[];
    mapperVersion?: number;
  } = {},
) {
  const ownCalls: string[] = [];
  const ownClosed: OwnClosedFeed | null = opts.own
    ? {
        async *fetchUpdates(closedSince) {
          ownCalls.push(closedSince);
          yield pageOf(opts.own!);
        },
        async *fetchKeys() {
          yield opts.own!.flatMap((r) => (r.ok ? [r.listing.listingKey] : []));
        },
      }
    : null;
  const provider: ListingProvider = {
    mapperVersion: opts.mapperVersion ?? 5,
    async *fetchUpdates() {
      if (records.length) yield pageOf(records, opts.feeCheck);
    },
    async *fetchActiveKeys() {
      yield records.flatMap((r) => (r.ok ? [r.listing.listingKey] : []));
    },
    ...(opts.byKeys ? { fetchByKeys: opts.byKeys } : {}),
    ownClosed,
  };
  return { provider, ownCalls };
}
