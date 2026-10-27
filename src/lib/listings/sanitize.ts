import { getTableColumns, type Column, type Table } from "drizzle-orm";
import { listings } from "@/db/schema";

/**
 * Guards numeric columns against values Postgres would reject. One bad value
 * (a feed's 2,182,094,640 sq ft lot in an `integer`) otherwise fails the whole
 * multi-row upsert it's in. The rules come from each column's drizzle type, so
 * a new numeric column is covered without touching this file.
 */

type NumericSpec = { min: number; max: number; integer: boolean; sqlType: string };

/** Largest finite float4. */
const REAL_MAX = 3.4028234663852886e38;

const SPECS: Record<string, NumericSpec> = {
  PgSmallInt: { min: -32_768, max: 32_767, integer: true, sqlType: "smallint" },
  PgInteger: { min: -2_147_483_648, max: 2_147_483_647, integer: true, sqlType: "integer" },
  PgReal: { min: -REAL_MAX, max: REAL_MAX, integer: false, sqlType: "real" },
  PgDoublePrecision: {
    min: -Number.MAX_VALUE,
    max: Number.MAX_VALUE,
    integer: false,
    sqlType: "double precision",
  },
};

/**
 * Numeric columns that can be negative. Every other one is a price, size,
 * count, year, fee or tax, where a negative value is a feed error.
 */
const SIGNED = new Set<Column>([listings.latitude, listings.longitude]);

/** Columns with a narrower range than their type's (bounds included). */
const BOUNDS = new Map<Column, { min: number; max: number }>([
  [listings.latitude, { min: -90, max: 90 }],
  [listings.longitude, { min: -180, max: 180 }],
]);

type ColumnRule = NumericSpec & { name: string; notNull: boolean; signed: boolean; range: string };

const rulesByTable = new WeakMap<Table, Map<string, ColumnRule>>();

function numericRules(table: Table): Map<string, ColumnRule> {
  let rules = rulesByTable.get(table);
  if (!rules) {
    rules = new Map();
    for (const [key, column] of Object.entries(getTableColumns(table))) {
      const spec = SPECS[column.columnType];
      if (!spec) continue;
      const bounds = BOUNDS.get(column);
      rules.set(key, {
        ...spec,
        ...bounds,
        name: column.name,
        notNull: column.notNull,
        signed: SIGNED.has(column),
        range: bounds ? `${bounds.min}..${bounds.max}` : spec.sqlType,
      });
    }
    rulesByTable.set(table, rules);
  }
  return rules;
}

/** Why `value` can't be stored in a column with `rule`, or null when it can. */
function problem(value: unknown, rule: ColumnRule): string | null {
  if (typeof value !== "number") return "not a number";
  if (!Number.isFinite(value)) return "not a finite number";
  if (rule.integer && !Number.isInteger(value)) return `not a whole number (${rule.sqlType})`;
  if (value < rule.min || value > rule.max) return `out of range for ${rule.range}`;
  // A nonzero value too small for float4 underflows, which Postgres rejects too.
  if (rule.sqlType === "real" && value !== 0 && Math.fround(value) === 0) {
    return "out of range for real";
  }
  if (!rule.signed && value < 0) return "negative";
  return null;
}

export type NumericIssue = { field: string; value: unknown; reason: string };

/** A row with an unstorable value in a NOT NULL column: it can't be written. */
export class InvalidRowError extends Error {
  constructor(
    readonly label: string,
    readonly issues: NumericIssue[],
  ) {
    super(
      `${label}: ${issues.map((i) => `${i.field} = ${String(i.value)} is ${i.reason}`).join("; ")}`,
    );
    this.name = "InvalidRowError";
  }
}

/**
 * `row` with every numeric column of `table` that holds a value Postgres would
 * reject (NaN, ±Infinity, out of the type's range, a fraction in an integer
 * column) or an impossible one (negative, or a latitude/longitude past ±90/±180)
 * set to null, each with a
 * warning naming `label`, the field and the raw value. Keys that aren't
 * numeric columns are left alone; `undefined` stays undefined (not written).
 * Throws InvalidRowError when such a value is in a NOT NULL column.
 */
export function sanitizeNumeric<T extends object>(
  table: Table,
  row: T,
  label: string,
  warn: (message: string) => void = console.warn,
): T {
  const rules = numericRules(table);
  let out: T | null = null;
  const fatal: NumericIssue[] = [];
  for (const [field, value] of Object.entries(row)) {
    const rule = rules.get(field);
    if (!rule || value === null || value === undefined) continue;
    const reason = problem(value, rule);
    if (!reason) continue;
    if (rule.notNull) {
      fatal.push({ field, value, reason });
      continue;
    }
    warn(`[listings] ${label}: ${field} = ${String(value)} is ${reason}; stored as null`);
    out ??= { ...row };
    (out as Record<string, unknown>)[field] = null;
  }
  if (fatal.length) throw new InvalidRowError(label, fatal);
  return out ?? row;
}
