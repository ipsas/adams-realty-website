import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  auditFeeAggregate,
  emptyFeeAudit,
  GAMLS_NOT_ANNUAL,
  type FeeGroup,
} from "@/lib/listings/fee-audit";
import { fakeFeed, FakeStore, record, START } from "./fee-sync.test-helpers";
import { FEE_AUDIT_PREFIX, runSync, type SyncMode } from "./sync-engine";

// The HOA fee audit at the end of a run, reported in the run's status like a quarantine.

const clock = () => START;
const CURSOR = { modifiedAt: new Date(START - 3_600_000), key: null };

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const alerts = () =>
  errors.mock.calls.map((c) => String(c[0])).filter((line) => line.includes("ALERT"));

const group = (frequency: string | null, count: number, examples: string[] = []): FeeGroup => ({
  frequency,
  count,
  sampleFee: 600,
  sampleSqlMonthly: frequency === "annually" ? 50 : frequency === "monthly" ? 600 : null,
  examples,
});

function storeWith(groups: FeeGroup[]) {
  const store = new FakeStore();
  store.cursor = CURSOR;
  store.audit = async () => auditFeeAggregate(groups, { gamls: true });
  return store;
}

describe("the run's HOA fee audit", () => {
  for (const frequency of ["monthly", null]) {
    it(`a Georgia MLS row stored as ${frequency} makes the run partial, loudly`, async () => {
      const store = storeWith([group("annually", 100), group(frequency, 2, ["7001", "7002"])]);
      const result = await runSync(store, fakeFeed([record("K1")]).provider, { now: clock });
      expect(result.status).toBe("partial");
      const outcome = store.finished[0];
      expect(outcome.status).toBe("partial");
      expect(outcome.caughtUp).toBe(true);
      const note = `${FEE_AUDIT_PREFIX} ${GAMLS_NOT_ANNUAL}: 2 e.g. MLS# 7001, 7002`;
      expect(outcome.error).toBe(note);
      expect(result.feeAudit?.stored).toEqual({
        total: 102,
        problems: { [GAMLS_NOT_ANNUAL]: 2 },
        examples: ["7001", "7002"],
      });
      expect(alerts()).toEqual([`[mls] ALERT gamls: ${note}`]);
    });
  }

  it("page fee-check mismatches make the run partial too", async () => {
    const store = storeWith([group("annually", 10)]);
    const feeCheck = { checked: 3, mismatched: 1, unrecognizedFrequency: { Yearly: 2 } };
    const result = await runSync(store, fakeFeed([record("K1")], { feeCheck }).provider, {
      now: clock,
    });
    expect(result.status).toBe("partial");
    expect(store.finished[0].error).toBe(
      `${FEE_AUDIT_PREFIX} fees mismatched the raw MLS data: 1; unrecognized AssociationFeeFrequency: 2`,
    );
    expect(result.feeAudit?.pages).toEqual(feeCheck);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain(FEE_AUDIT_PREFIX);
  });

  it("a run stopped by its deadline stays partial, with the note", async () => {
    const store = storeWith([group("monthly", 1, ["9"])]);
    // A deadline already passed: the run stops after its first page (partial).
    const result = await runSync(store, fakeFeed([record("K1")]).provider, {
      now: clock,
      deadline: START - 1,
    });
    expect(result.status).toBe("partial");
    expect(store.finished[0].caughtUp).toBe(false);
    expect(store.finished[0].error).toContain(FEE_AUDIT_PREFIX);
  });

  it("a clean audit leaves the run succeeded, with no note", async () => {
    const store = storeWith([group("annually", 10)]);
    const feeCheck = { checked: 3, mismatched: 0, unrecognizedFrequency: {} };
    const result = await runSync(store, fakeFeed([record("K1")], { feeCheck }).provider, {
      now: clock,
    });
    expect(result.status).toBe("succeeded");
    expect(store.finished[0].error).toBeUndefined();
    expect(result.feeAudit).toBeUndefined();
    expect(alerts()).toEqual([]);
  });

  it("an audit query that throws is logged and noted, and doesn't fail the run", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.audit = async () => {
      throw new Error("connection reset");
    };
    const result = await runSync(store, fakeFeed([record("K1")]).provider, { now: clock });
    expect(result.status).toBe("succeeded");
    expect(store.finished[0].status).toBe("succeeded");
    expect(store.finished[0].error).toContain("HOA fee audit could not run");
    expect(errors.mock.calls.flat().join("\n")).toContain("connection reset");
  });

  it("runs after incremental and purge runs, not after a full one", async () => {
    const calls: Record<SyncMode, number> = { incremental: 0, purge: 0, full: 0 };
    for (const mode of ["incremental", "purge", "full"] as const) {
      const store = new FakeStore();
      store.cursor = CURSOR;
      await runSync(store, fakeFeed([record("K1")]).provider, { mode, now: clock });
      calls[mode] = store.auditCalls;
    }
    expect(calls).toEqual({ incremental: 1, purge: 1, full: 0 });
  });

  it("a purge whose audit finds a problem stays succeeded, with the note", async () => {
    // The dashboard dates the last purge from its succeeded runs (getSources).
    const store = storeWith([group(null, 3)]);
    const result = await runSync(store, fakeFeed([record("K1")]).provider, {
      mode: "purge",
      now: clock,
    });
    expect(result.status).toBe("succeeded");
    expect(store.finished[0].status).toBe("succeeded");
    const note = `${FEE_AUDIT_PREFIX} ${GAMLS_NOT_ANNUAL}: 3`;
    expect(store.finished[0].error).toBe(note);
    expect(result.feeAudit?.stored?.problems).toEqual({ [GAMLS_NOT_ANNUAL]: 3 });
    expect(alerts()).toEqual([`[mls] ALERT gamls: ${note}`]);
  });

  it("the empty audit is clean", async () => {
    const store = new FakeStore();
    store.audit = async () => emptyFeeAudit();
    const result = await runSync(store, fakeFeed([]).provider, { now: clock });
    expect(result.status).toBe("succeeded");
  });
});
