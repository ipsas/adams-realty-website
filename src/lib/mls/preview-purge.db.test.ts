import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { buildDbVerdict, neonBranchVerdict } from "../../../scripts/preview-purge.mjs";
import { PREVIEW_BRANCH, PREVIEW_PROJECT } from "./preview-purge.mjs";

/**
 * The test database is a plain Postgres with no Neon settings, so a branch
 * check that ignores client startup options must refuse it, however the
 * connection claims to be the preview branch.
 */
const FORGED = `-c neon.branch_id=${PREVIEW_BRANCH} -c neon.project_id=${PREVIEW_PROJECT}`;

function testUrl(options?: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  if (options) url.searchParams.set("options", options);
  return url.toString();
}

const saved = { PGOPTIONS: process.env.PGOPTIONS, VERCEL_ENV: process.env.VERCEL_ENV };
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function showBranch(connectionString: string): Promise<string | null> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query("SHOW neon.branch_id");
    return rows[0]?.["neon.branch_id"] ?? null;
  } finally {
    await client.end();
  }
}

describe.each([
  ["the URL's options parameter", () => testUrl(FORGED)],
  [
    "PGOPTIONS",
    () => {
      process.env.PGOPTIONS = FORGED;
      return testUrl();
    },
  ],
])("a preview branch claimed through %s", (_, url) => {
  it("does fool a plain pg client (the attack)", async () => {
    expect(await showBranch(url())).toBe(PREVIEW_BRANCH);
  });

  it("is refused by buildDbVerdict on a preview build", async () => {
    process.env.VERCEL_ENV = "preview";
    const lines: string[] = [];
    expect(await buildDbVerdict(url(), (l) => lines.push(l))).toBe("refuse");
    expect(lines).toContain(
      "Database branch check: env=preview project=null branch=null -> refuse",
    );
  });

  it("is refused by neonBranchVerdict", async () => {
    const lines: string[] = [];
    expect(await neonBranchVerdict(url(), "Test", (l) => lines.push(l))).toBe("refuse");
    expect(lines).toContain("Test branch check: project=null branch=null -> refuse");
  });
});
