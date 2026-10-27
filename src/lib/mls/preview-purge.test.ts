import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { neonEndpointLabel } from "../../../scripts/preview-purge.mjs";
import {
  PREVIEW_BRANCH,
  PREVIEW_PROJECT,
  PROD_BRANCH,
  branchCheckConfig,
  buildDbDecision,
  checkBranch,
  isTrustedSettingSource,
  newBranchCheckClient,
  purgeDecision,
  trustedNeonIds,
} from "./preview-purge.mjs";

const FORGED = `-c neon.branch_id=${PREVIEW_BRANCH} -c neon.project_id=${PREVIEW_PROJECT}`;

describe("branchCheckConfig", () => {
  it("removes the options parameter and keeps the rest", () => {
    const url = `postgres://u:p@db.example.com:5432/app?sslmode=require&options=${encodeURIComponent(FORGED)}&application_name=build`;
    const out = new URL(branchCheckConfig(url).connectionString);
    expect(out.searchParams.has("options")).toBe(false);
    expect(out.searchParams.get("sslmode")).toBe("require");
    expect(out.searchParams.get("application_name")).toBe("build");
    expect(out.host).toBe("db.example.com:5432");
    expect(out.pathname).toBe("/app");
  });

  it("removes every and percent-encoded copy of options", () => {
    const url = "postgres://u:p@h/app?options=a&%6Fptions=b&options=";
    expect(new URL(branchCheckConfig(url).connectionString).search).toBe("");
  });

  it("throws, without echoing the input, on a non-URL", () => {
    expect(() => branchCheckConfig("secret-not-a-url")).toThrow(
      "Branch check: the database URL is not a URL.",
    );
  });
});

describe("newBranchCheckClient", () => {
  const saved = process.env.PGOPTIONS;
  afterEach(() => {
    if (saved === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = saved;
  });

  it("resolves no startup options from the URL or PGOPTIONS, and restores PGOPTIONS", () => {
    process.env.PGOPTIONS = FORGED;
    const url = `postgres://u:p@h/app?sslmode=disable&options=${encodeURIComponent(FORGED)}`;
    const client = newBranchCheckClient(pg.Client, url) as pg.Client & {
      connectionParameters: { options?: string; ssl: unknown };
    };
    expect(client.connectionParameters.options).toBeUndefined();
    expect(client.connectionParameters.ssl).toBe(false);
    expect(process.env.PGOPTIONS).toBe(FORGED);
  });

  it("a plain pg.Client would have used them (what this guards against)", () => {
    process.env.PGOPTIONS = FORGED;
    const client = new pg.Client({ connectionString: "postgres://u:p@h/app" }) as pg.Client & {
      connectionParameters: { options?: string };
    };
    expect(client.connectionParameters.options).toBe(FORGED);
  });

  it("refuses if pg still resolves options", () => {
    class Leaky {
      connectionParameters = { options: "-c x=y" };
    }
    expect(() => newBranchCheckClient(Leaky, "postgres://u:p@h/app")).toThrow(/startup options/);
  });
});

describe("neonEndpointLabel", () => {
  it("returns only the ep- label of a .neon.tech host", () => {
    const url =
      "postgres://neondb_owner:s3cret@ep-cool-rain-a1b2c3-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const label = neonEndpointLabel(url);
    expect(label).toBe("ep-cool-rain-a1b2c3-pooler");
    for (const leak of ["postgres://", "s3cret", "neondb_owner", "aws.neon.tech"]) {
      expect(label).not.toContain(leak);
    }
  });

  it("is null for other hosts, labels or non-URLs", () => {
    for (const url of [
      "postgres://u:p@localhost:5432/app",
      "postgres://u:p@ep-x.neon.tech.evil.com/app",
      "postgres://u:p@db.neon.tech/app",
      "postgres://u:p@ep-x.example.com/app",
      "not a url",
    ]) {
      expect(neonEndpointLabel(url)).toBeNull();
    }
  });
});

describe("isTrustedSettingSource", () => {
  it("trusts only server-side sources", () => {
    for (const s of ["configuration file", "command line"]) {
      expect(isTrustedSettingSource(s)).toBe(true);
    }
  });

  it("distrusts a missing row and every other source", () => {
    for (const s of [
      null,
      undefined,
      "client",
      "session",
      "user",
      "database",
      "database user",
      "default",
      "override",
      "environment variable",
    ]) {
      expect(isTrustedSettingSource(s)).toBe(false);
    }
  });
});

describe("trustedNeonIds", () => {
  const fromConfig = {
    "neon.project_id": { source: "configuration file", value: PREVIEW_PROJECT },
    "neon.branch_id": { source: "configuration file", value: PREVIEW_BRANCH },
  };

  it("keeps both ids on Neon (configuration file, no role/database settings)", () => {
    expect(trustedNeonIds({ settings: fromConfig, roleSettings: 0 })).toEqual({
      projectId: PREVIEW_PROJECT,
      branchId: PREVIEW_BRANCH,
      reasons: [],
    });
  });

  it("drops an id with no pg_settings row", () => {
    const out = trustedNeonIds({
      settings: { "neon.project_id": fromConfig["neon.project_id"] },
      roleSettings: 0,
    });
    expect(out).toEqual({
      projectId: PREVIEW_PROJECT,
      branchId: null,
      reasons: ["neon.branch_id has no pg_settings row"],
    });
  });

  it("drops an id whose source is null", () => {
    const out = trustedNeonIds({
      settings: { ...fromConfig, "neon.project_id": { source: null, value: PREVIEW_PROJECT } },
      roleSettings: 0,
    });
    expect(out).toEqual({
      projectId: null,
      branchId: PREVIEW_BRANCH,
      reasons: ["neon.project_id has no pg_settings row"],
    });
  });

  it('drops an id from source "database"', () => {
    const out = trustedNeonIds({
      settings: { ...fromConfig, "neon.branch_id": { source: "database", value: PREVIEW_BRANCH } },
      roleSettings: 0,
    });
    expect(out).toEqual({
      projectId: PREVIEW_PROJECT,
      branchId: null,
      reasons: ['neon.branch_id comes from source "database"'],
    });
  });

  it("drops both ids if a neon.* role/database setting exists", () => {
    const out = trustedNeonIds({ settings: fromConfig, roleSettings: 1 });
    expect(out).toEqual({
      projectId: null,
      branchId: null,
      reasons: ["neon.* role/database settings exist"],
    });
  });

  it("drops both ids if the role/database settings are unreadable", () => {
    const out = trustedNeonIds({ settings: fromConfig, roleSettings: null });
    expect(out).toEqual({
      projectId: null,
      branchId: null,
      reasons: ["neon.* role/database settings are unreadable"],
    });
  });

  it("never puts a value in a reason", () => {
    const { reasons } = trustedNeonIds({
      settings: {
        "neon.project_id": { source: "client", value: PREVIEW_PROJECT },
        "neon.branch_id": { source: null, value: PREVIEW_BRANCH },
      },
      roleSettings: 2,
    });
    for (const r of reasons) {
      expect(r).not.toContain(PREVIEW_PROJECT);
      expect(r).not.toContain(PREVIEW_BRANCH);
    }
  });
});

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

describe("buildDbDecision", () => {
  const preview = { projectId: PREVIEW_PROJECT, branchId: PREVIEW_BRANCH };

  it("production: ok only on the production branch, fatal on anything else", () => {
    expect(
      buildDbDecision("production", { projectId: PREVIEW_PROJECT, branchId: PROD_BRANCH }),
    ).toBe("ok");
    expect(buildDbDecision("production", preview)).toBe("fatal");
    expect(buildDbDecision("production", { projectId: null, branchId: null })).toBe("fatal");
  });

  it("preview: follows checkBranch", () => {
    expect(buildDbDecision("preview", preview)).toBe("ok");
    expect(buildDbDecision("preview", { projectId: PREVIEW_PROJECT, branchId: PROD_BRANCH })).toBe(
      "fatal",
    );
    expect(buildDbDecision("preview", { projectId: "other-project", branchId: "br-other" })).toBe(
      "refuse",
    );
    expect(buildDbDecision("preview", { projectId: null, branchId: null })).toBe("refuse");
  });

  it("refuses in development or with no VERCEL_ENV", () => {
    for (const env of ["development", undefined, ""]) {
      expect(buildDbDecision(env, preview)).toBe("refuse");
      expect(buildDbDecision(env, { projectId: null, branchId: PROD_BRANCH })).toBe("refuse");
    }
  });
});
