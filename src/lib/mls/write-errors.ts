import { DrizzleQueryError } from "drizzle-orm";
import { InvalidRowError } from "@/lib/listings/sanitize";

/**
 * Write failures during a sync: what to log, and which ones a single record
 * caused (so the rest of its page can still be written).
 */

type DbErrorFields = {
  code?: unknown;
  detail?: unknown;
  table?: unknown;
  column?: unknown;
  constraint?: unknown;
};

/** `error` and its `.cause`s, outermost first. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let e = error; e != null && chain.length < 10 && !chain.includes(e);) {
    chain.push(e);
    e = e instanceof Error ? e.cause : undefined;
  }
  return chain;
}

/** The Postgres error in the chain (node-postgres sets a SQLSTATE `code`). */
function pgError(error: unknown): DbErrorFields | undefined {
  return causeChain(error).find(
    (e): e is DbErrorFields =>
      typeof e === "object" && e !== null && typeof (e as DbErrorFields).code === "string",
  );
}

const REDACTED = "[redacted]";

/** What follows `Key (cols)=(values)` in a 23505/23503 detail, when it holds no values. */
const KEY_DETAIL_SUFFIX =
  /\) (already exists|is not present in table "[^"]*"|is still referenced from table "[^"]*")\.$/;

/**
 * A Postgres `detail` without the row's values (they can be an address or an
 * email): the columns of `Key (cols)=(values) …` and the fact of `Failing row
 * contains (…)` are kept; any other detail is dropped (null).
 */
export function redactDetail(detail: string): string | null {
  if (detail.startsWith("Failing row contains (")) return `Failing row contains (${REDACTED}).`;
  const key = /^Key \((.+?)\)=\(/.exec(detail);
  if (!key) return null;
  const suffix = KEY_DETAIL_SUFFIX.exec(detail);
  return `Key (${key[1]})=(${REDACTED})${suffix ? ` ${suffix[1]}.` : ""}`;
}

/**
 * A data exception's message (SQLSTATE class 22) quotes the offending value,
 * e.g. `invalid input syntax for type integer: "abc"`: everything from its
 * first to its last double quote goes. Other classes quote only identifiers.
 */
function redactMessage(message: string, code: unknown): string {
  return typeof code === "string" && code.startsWith("22")
    ? message.replace(/"[\s\S]*"/, `"${REDACTED}"`)
    : message;
}

/**
 * The real reason a write failed, for logs, the run record, the dashboard and
 * the cron response: the Postgres message with its code, table, column,
 * constraint and detail, with row values redacted (redactMessage, redactDetail).
 * Drizzle wraps driver errors in "Failed query: <sql> params: <values>" with
 * the cause as `.cause`; that wrapper (a whole page's SQL and values) is
 * skipped, as is any other wrapper around a Postgres error (SyncFailedError).
 */
export function describeError(error: unknown): string {
  const pg = pgError(error);
  if (!pg) {
    const inner = causeChain(error).find((e) => !(e instanceof DrizzleQueryError));
    if (inner === undefined) return "Database query failed";
    return inner instanceof Error ? inner.message : String(inner);
  }
  const message = redactMessage(pg instanceof Error ? pg.message : String(pg), pg.code);
  const fields = (["code", "table", "column", "constraint", "detail"] as const)
    .map((k) => {
      const value = pg[k];
      if (typeof value !== "string" || value === "") return null;
      const shown = k === "detail" ? redactDetail(value) : value;
      return shown === null ? null : `${k}: ${shown}`;
    })
    .filter((f) => f !== null);
  return fields.length ? `${message} (${fields.join(", ")})` : message;
}

/** A page fails whole when every row, or more than this fraction of its rows, is rejected… */
export const MAX_REJECTED_FRACTION = 0.5;
/**
 * …provided it has at least this many rows. A smaller page never fails: its
 * rejected rows are skipped even when all are, so a lone permanently bad
 * record can't stall the incremental sync.
 */
export const MIN_ROWS_FOR_REJECTED_FRACTION = 10;

/**
 * So many of a page's rows were rejected that the cause is systemic (a schema
 * mismatch, a mapper bug), not a bad record: the page must not be written, nor
 * the cursor moved past it.
 */
export class PageRejectedError extends Error {
  constructor(
    readonly rejected: number,
    readonly total: number,
    firstReason: string,
  ) {
    super(
      `${rejected} of ${total} rows rejected on page; not advancing cursor. First error: ${firstReason}`,
    );
    this.name = "PageRejectedError";
  }
}

/**
 * The error is the record's fault, not the database's or the connection's:
 * an unstorable value (InvalidRowError), or a Postgres data exception (SQLSTATE
 * class 22, e.g. 22003 numeric out of range) or integrity violation (class 23).
 * Anything else (connection lost, timeout) must fail the page, never skip it.
 */
export function isRowLevelError(error: unknown): boolean {
  if (causeChain(error).some((e) => e instanceof InvalidRowError)) return true;
  const code = pgError(error)?.code;
  return typeof code === "string" && (code.startsWith("22") || code.startsWith("23"));
}

/**
 * Writes `items` with `write` (which must undo its own partial work when it
 * throws, e.g. by running in a savepoint). If a batch fails because of a
 * record, it's split in halves and each retried, down to single records: every
 * good record is written, and each one that fails alone is reported to
 * `onRowFailed` and skipped. Other errors are rethrown. When there are at least
 * MIN_ROWS_FOR_REJECTED_FRACTION records and every one, or more than
 * MAX_REJECTED_FRACTION of them, fails, throws PageRejectedError: the caller's
 * transaction must then roll back the records that were written. Fewer records
 * never throw, even if all fail.
 */
export async function writeIsolated<T, R>(
  items: T[],
  write: (batch: T[]) => Promise<R[]>,
  onRowFailed: (item: T, error: unknown) => void,
): Promise<{ results: R[]; failed: T[] }> {
  const results: R[] = [];
  const failed: T[] = [];
  let firstError: unknown;
  const attempt = async (batch: T[]): Promise<void> => {
    if (!batch.length) return;
    try {
      results.push(...(await write(batch)));
    } catch (error) {
      if (!isRowLevelError(error)) throw error;
      if (batch.length === 1) {
        if (!failed.length) firstError = error;
        failed.push(batch[0]);
        onRowFailed(batch[0], error);
        return;
      }
      const mid = Math.ceil(batch.length / 2);
      await attempt(batch.slice(0, mid));
      await attempt(batch.slice(mid));
    }
  };
  await attempt(items);
  if (
    items.length >= MIN_ROWS_FOR_REJECTED_FRACTION &&
    (failed.length === items.length || failed.length > items.length * MAX_REJECTED_FRACTION)
  ) {
    throw new PageRejectedError(failed.length, items.length, describeError(firstError));
  }
  return { results, failed };
}
