import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

async function admin(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: testUrl() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * Spoofs in schema public, put ahead of pg_catalog by the database's
 * search_path, that an unqualified catalog read would resolve to.
 */
describe("a preview branch claimed through search_path spoofs", () => {
  beforeAll(async () => {
    await admin(`
      create view public.pg_settings as
        select n.name, 'configuration file'::text as source, null::text as setting
        from (values ('neon.branch_id'), ('neon.project_id')) as n(name);
      create function public.current_setting(text, boolean) returns text language sql as $$
        select case $1 when 'neon.branch_id' then '${PREVIEW_BRANCH}'
          when 'neon.project_id' then '${PREVIEW_PROJECT}' end
      $$;
      do $$ begin
        execute format('alter database %I set search_path = public, pg_catalog', current_database());
      end $$;`);
  });

  afterAll(async () => {
    await admin(`
      do $$ begin
        execute format('alter database %I reset search_path', current_database());
      end $$;
      drop view if exists public.pg_settings;
      drop function if exists public.current_setting(text, boolean);`);
  });

  it("does fool unqualified catalog reads (the attack)", async () => {
    const client = new pg.Client({ connectionString: testUrl() });
    await client.connect();
    try {
      const { rows } = await client.query(
        "select source, current_setting(name, true) as v from pg_settings where name = 'neon.branch_id'",
      );
      expect(rows).toEqual([{ source: "configuration file", v: PREVIEW_BRANCH }]);
    } finally {
      await client.end();
    }
  });

  it("is refused by buildDbVerdict on a preview build, logging no connection details", async () => {
    process.env.VERCEL_ENV = "preview";
    const lines: string[] = [];
    expect(await buildDbVerdict(testUrl(), (l) => lines.push(l))).toBe("refuse");
    expect(lines).toContain(
      "Database branch check: env=preview project=null branch=null -> refuse",
    );
    expect(lines).toContain("Database branch check: neon.branch_id pg_settings source=none");
    expect(lines).toContain("Database branch check: neon.project_id pg_settings source=none");
    expect(lines).toContain("Database branch check: host endpoint=none");
    expect(lines).toContain("Database branch check: neon.* role/database settings=0");
    expect(lines).toContain(
      "Database branch check: neon.branch_id has no pg_settings row; not trusted, ignored.",
    );
    const { password, hostname } = new URL(testUrl());
    for (const line of lines) {
      expect(line).not.toContain("postgres://");
      expect(line).not.toContain(hostname);
      if (password) expect(line).not.toContain(password);
    }
  });

  it("is refused by neonBranchVerdict", async () => {
    const lines: string[] = [];
    expect(await neonBranchVerdict(testUrl(), "Test", (l) => lines.push(l))).toBe("refuse");
    expect(lines).toContain("Test branch check: project=null branch=null -> refuse");
  });
});

/**
 * Defaults a database owner or the role itself can store in
 * pg_db_role_setting. On vanilla Postgres neon.* are placeholders with no
 * pg_settings row, so SHOW reports the stored value.
 */
const SET_IDS = `set neon.project_id = '${PREVIEW_PROJECT}'`;
const SET_BRANCH = `set neon.branch_id = '${PREVIEW_BRANCH}'`;

function alterEach(target: string, action: string): string {
  return `do $$ begin
    execute format('alter ${target} ${action.replaceAll("'", "''")}', current_user, current_database());
  end $$;`;
}

const TARGETS = [
  ["ALTER DATABASE", "database %2$I"],
  ["ALTER ROLE", "role %1$I"],
  ["ALTER ROLE ... IN DATABASE", "role %1$I in database %2$I"],
] as const;

async function resetAll(): Promise<void> {
  for (const [, target] of TARGETS) {
    await admin(
      alterEach(target, "reset neon.project_id") + alterEach(target, "reset neon.branch_id"),
    );
  }
}

describe.each(TARGETS)("a preview branch claimed through %s", (_, target) => {
  beforeAll(resetAll);
  afterAll(resetAll);

  beforeAll(async () => {
    await admin(alterEach(target, SET_IDS) + alterEach(target, SET_BRANCH));
  });

  it("does fool a plain pg client (the attack)", async () => {
    expect(await showBranch(testUrl())).toBe(PREVIEW_BRANCH);
  });

  it("is refused by buildDbVerdict on a preview build", async () => {
    process.env.VERCEL_ENV = "preview";
    const lines: string[] = [];
    expect(await buildDbVerdict(testUrl(), (l) => lines.push(l))).toBe("refuse");
    expect(lines).toContain(
      "Database branch check: env=preview project=null branch=null -> refuse",
    );
    expect(lines).toContain("Database branch check: neon.* role/database settings=2");
    expect(lines).toContain(
      "Database branch check: neon.* role/database settings exist; not trusted, ignored.",
    );
    expect(lines).toContain(
      "Database branch check: neon.project_id has no pg_settings row; not trusted, ignored.",
    );
    expect(lines).toContain(
      "Database branch check: neon.branch_id has no pg_settings row; not trusted, ignored.",
    );
    for (const line of lines) {
      expect(line).not.toContain(PREVIEW_BRANCH);
      expect(line).not.toContain(PREVIEW_PROJECT);
    }
  });

  it("is refused by neonBranchVerdict", async () => {
    const lines: string[] = [];
    expect(await neonBranchVerdict(testUrl(), "Test", (l) => lines.push(l))).toBe("refuse");
    expect(lines).toContain("Test branch check: project=null branch=null -> refuse");
    expect(lines).toContain("Test branch check: neon.* role/database settings=2");
    expect(lines).toContain(
      "Test branch check: neon.* role/database settings exist; not trusted, ignored.",
    );
  });
});
