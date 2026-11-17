/**
 * The max-HOA filter ("No HOA fee" = maxHoa 0, "Max $50"…), checked twice over the same
 * fixtures: the JS rule (`hoaFilterAmount`) and the SQL the search and saved-search alerts
 * actually run (`buildConditions`/`buildWhere`), rendered and evaluated row by row here.
 * A fee of unknown period, one-time or seasonal is compared at its full amount, so it never
 * slips through as "unknown". Pure: no database.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { hoaFilterAmount, MONTHLY_FACTORS } from "@/lib/listings/hoa-fee";
import { parseSearchParams } from "./params";
import { buildConditions, buildWhere } from "./query";

const dialect = new PgDialect();
const now = new Date("2026-11-16T12:00:00Z");

type Row = { name: string; fee: number | null; frequency: string | null };

const ROWS: Row[] = [
  { name: "GAMLS no-period 500", fee: 500, frequency: null },
  { name: "non-GAMLS no-period 439", fee: 439, frequency: null },
  { name: "one_time 1000", fee: 1000, frequency: "one_time" },
  { name: "seasonal 200", fee: 200, frequency: "seasonal" },
  { name: "annually 500", fee: 500, frequency: "annually" },
  { name: "monthly 84", fee: 84, frequency: "monthly" },
  { name: "monthly 40", fee: 40, frequency: "monthly" },
  { name: "quarterly 300", fee: 300, frequency: "quarterly" },
  { name: "quarterly 120", fee: 120, frequency: "quarterly" },
  { name: "no fee", fee: null, frequency: null },
  { name: "fee 0", fee: 0, frequency: null },
];

const EXPECTED: Record<number, string[]> = {
  0: ["no fee", "fee 0"],
  50: ["annually 500", "monthly 40", "quarterly 120", "no fee", "fee 0"],
};

const MAX_HOAS = [0, 50] as const;

function jsPasses(r: Row, maxHoa: number): boolean {
  if (r.fee === null) return true;
  const amount = hoaFilterAmount(r.fee, r.frequency);
  return amount !== null && amount <= maxHoa;
}

describe("max HOA filter: JS rule", () => {
  for (const maxHoa of MAX_HOAS) {
    it(`maxHoa=${maxHoa} passes exactly ${EXPECTED[maxHoa].join(", ")}`, () => {
      const passing = ROWS.filter((r) => jsPasses(r, maxHoa)).map((r) => r.name);
      expect(passing.sort()).toEqual([...EXPECTED[maxHoa]].sort());
    });
  }

  it("compares known periods by monthly equivalent and the rest at the full amount", () => {
    expect(hoaFilterAmount(500, "annually")).toBeCloseTo(41.67, 2);
    expect(hoaFilterAmount(500, null)).toBe(500);
    expect(hoaFilterAmount(1000, "one_time")).toBe(1000);
    expect(hoaFilterAmount(200, "seasonal")).toBe(200);
    expect(hoaFilterAmount(200, "bogus")).toBe(200);
    expect(hoaFilterAmount(0, null)).toBe(0);
    expect(hoaFilterAmount(null, "monthly")).toBeNull();
  });
});

// --- SQL: render the real condition, then evaluate it per row ---------------------------

const FEE = `"listings"."hoa_fee"`;
const FREQ = `"listings"."hoa_frequency"`;

/** The rendered max-HOA condition (the only one that reads hoa_frequency) and its params. */
function maxHoaCondition(maxHoa: number) {
  const conds = buildConditions(parseSearchParams({ maxHoa: String(maxHoa) }), now);
  const rendered = conds.map((c) => dialect.sqlToQuery(c)).filter((q) => q.sql.includes(FREQ));
  expect(rendered).toHaveLength(1);
  return rendered[0];
}

function stripParens(s: string): string {
  s = s.trim();
  while (s.startsWith("(") && s.endsWith(")") && closingParen(s, 0) === s.length - 1)
    s = s.slice(1, -1).trim();
  return s;
}

function closingParen(s: string, open: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    if (ch === ")" && --depth === 0) return i;
  }
  throw new Error(`unbalanced parentheses in ${s}`);
}

/** Splits on `sep` outside parentheses and quotes. */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim());
}

type Value = number | null;

/** Evaluates the value expressions the condition may contain: the fee, null, coalesce, case. */
function evalExpr(expr: string, r: Row): Value {
  const e = stripParens(expr);
  if (e === FEE) return r.fee;
  if (e === "null") return null;
  if (e.startsWith("coalesce(") && closingParen(e, "coalesce".length) === e.length - 1) {
    for (const arg of splitTopLevel(e.slice("coalesce(".length, -1), ",")) {
      const v = evalExpr(arg, r);
      if (v !== null) return v;
    }
    return null;
  }
  const caseMatch = e.match(/^case "listings"\."hoa_frequency" (.*) else (.*) end$/);
  if (caseMatch) {
    // The when pairs are read from the rendered SQL, not from MONTHLY_FACTORS.
    const whens = [
      ...caseMatch[1].matchAll(/when '(\w+)' then "listings"\."hoa_fee" \* (\d+) \/ (\d+)\.0/g),
    ];
    expect(caseMatch[1].split("when ").length - 1).toBe(whens.length);
    const hit = whens.find((w) => w[1] === r.frequency);
    if (hit) return r.fee === null ? null : (r.fee * Number(hit[2])) / Number(hit[3]);
    return evalExpr(caseMatch[2], r);
  }
  throw new Error(`unsupported expression: ${e}`);
}

/** SQL three-valued logic, collapsed to "row kept" (true) or not. */
function evalCondition(cond: string, params: unknown[], r: Row): boolean {
  return splitTopLevel(stripParens(cond), " or ").some((d) => {
    const isNull = d.match(/^(.*) is null$/);
    if (isNull) return evalExpr(isNull[1], r) === null;
    const lte = d.match(/^(.*) <= \$(\d+)$/);
    if (lte) {
      const v = evalExpr(lte[1], r);
      return v !== null && v <= Number(params[Number(lte[2]) - 1]);
    }
    throw new Error(`unsupported condition: ${d}`);
  });
}

describe("max HOA filter: rendered SQL", () => {
  it("wraps the monthly CASE and the fee in coalesce, with no unknown-period pass-through", () => {
    const { sql } = maxHoaCondition(50);
    expect(sql).toContain(`coalesce((case ${FREQ} when `);
    expect(sql).toContain(`else null end), ${FEE}) <= $`);
    // The only `is null` left is "no fee at all".
    expect(sql.match(/is null/g)).toEqual(["is null"]);
    expect(sql).toContain(`${FEE} is null or `);
    expect(sql).not.toContain("end) is null");
  });

  it("lists every MONTHLY_FACTORS period in the CASE with its factor", () => {
    const { sql } = maxHoaCondition(50);
    for (const [k, f] of Object.entries(MONTHLY_FACTORS))
      expect(sql).toContain(`when '${k}' then ${FEE} * ${f.mul} / ${f.div}.0`);
  });

  it("is the condition saved-search alerts run too (buildWhere)", () => {
    const where = buildWhere(parseSearchParams({ maxHoa: "50" }), now);
    expect(where).toBeDefined();
    const fragment = maxHoaCondition(50).sql.replace(/\$\d+/g, "");
    expect(dialect.sqlToQuery(where!).sql.replace(/\$\d+/g, "")).toContain(fragment);
  });

  for (const maxHoa of MAX_HOAS) {
    it(`maxHoa=${maxHoa}: evaluating the SQL per row matches the JS rule and the table`, () => {
      const { sql, params } = maxHoaCondition(maxHoa);
      const passing = ROWS.filter((r) => evalCondition(sql, params, r)).map((r) => r.name);
      expect(passing.sort()).toEqual([...EXPECTED[maxHoa]].sort());
      for (const r of ROWS) expect(evalCondition(sql, params, r), r.name).toBe(jsPasses(r, maxHoa));
    });
  }
});
