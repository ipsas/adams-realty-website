import { describe, expect, it } from "vitest";
import { shouldSyncFeed } from "./preview-sync.mjs";

const ready = {
  VERCEL_ENV: "preview",
  MLS_SYNC_ENABLED: "true",
  MLS_GAMLS_TOKEN: "t",
  MLS_GAMLS_DATASET: "d",
};

describe("shouldSyncFeed", () => {
  it("runs only on a preview with MLS_SYNC_ENABLED=true, a token and a dataset", () => {
    expect(shouldSyncFeed(ready).run).toBe(true);
  });

  it('skips unless MLS_SYNC_ENABLED is exactly "true"', () => {
    for (const v of [undefined, "", "1", "TRUE", "yes"]) {
      expect(shouldSyncFeed({ ...ready, MLS_SYNC_ENABLED: v })).toEqual({
        run: false,
        reason: 'MLS_SYNC_ENABLED is not "true"',
      });
    }
  });

  it("names the missing condition without printing values", () => {
    expect(shouldSyncFeed({ ...ready, VERCEL_ENV: "production" }).reason).toBe(
      "not a preview build",
    );
    expect(shouldSyncFeed({ ...ready, MLS_GAMLS_TOKEN: undefined }).reason).toBe(
      "MLS_GAMLS_TOKEN is not set",
    );
    const r = shouldSyncFeed({ ...ready, MLS_GAMLS_DATASET: "" });
    expect(r).toEqual({ run: false, reason: "MLS_GAMLS_DATASET is not set" });
    expect(shouldSyncFeed({ ...ready, MLS_GAMLS_TOKEN: "secret-x" }).reason).not.toContain(
      "secret",
    );
  });
});
