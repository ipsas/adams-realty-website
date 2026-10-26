import { describe, expect, it } from "vitest";
import {
  PREVIEW_BRANCH,
  PREVIEW_PROJECT,
  PROD_BRANCH,
  checkBranch,
  purgeDecision,
} from "./preview-purge.mjs";

describe("purgeDecision", () => {
  it('runs only on a preview with MLS_PREVIEW_PURGE exactly "true"', () => {
    expect(purgeDecision({ VERCEL_ENV: "preview", MLS_PREVIEW_PURGE: "true" }).run).toBe(true);
  });

  it("is a no-op outside previews even with the flag set", () => {
    for (const v of ["production", "development", undefined]) {
      expect(purgeDecision({ VERCEL_ENV: v, MLS_PREVIEW_PURGE: "true" })).toEqual({
        run: false,
        reason: "not a preview build",
      });
    }
  });

  it('skips unless the flag is exactly "true"', () => {
    for (const v of [undefined, "", "TRUE", "1"]) {
      expect(purgeDecision({ VERCEL_ENV: "preview", MLS_PREVIEW_PURGE: v })).toEqual({
        run: false,
        reason: 'MLS_PREVIEW_PURGE is not "true"',
      });
    }
  });
});

describe("checkBranch", () => {
  it("is ok only for the preview project and branch", () => {
    expect(checkBranch({ projectId: PREVIEW_PROJECT, branchId: PREVIEW_BRANCH })).toBe("ok");
  });

  it("refuses a wrong project or a wrong or missing branch", () => {
    expect(checkBranch({ projectId: "other-project", branchId: PREVIEW_BRANCH })).toBe("refuse");
    expect(checkBranch({ projectId: PREVIEW_PROJECT, branchId: "br-other" })).toBe("refuse");
    expect(checkBranch({ projectId: PREVIEW_PROJECT, branchId: null })).toBe("refuse");
    expect(checkBranch({ projectId: null, branchId: null })).toBe("refuse");
    expect(checkBranch({})).toBe("refuse");
  });

  it("is fatal for the production branch, even with the preview project", () => {
    expect(checkBranch({ projectId: PREVIEW_PROJECT, branchId: PROD_BRANCH })).toBe("fatal");
    expect(checkBranch({ projectId: null, branchId: PROD_BRANCH })).toBe("fatal");
  });
});
