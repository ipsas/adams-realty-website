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

/**
 * The real reason a write failed, for logs and the run record: the Postgres
 * message with its code, table, column, constraint and detail. Drizzle wraps
 * driver errors in "Failed query: <sql> params: <values>" with the Postgres
 * error as `.cause`; that wrapper (a whole page's SQL and values) is skipped,
 * as is any other wrapper around a Postgres error (SyncFailedError).
 */
export function describeError(error: unknown): string {
  const pg = pgError(error);
  if (!pg) return error instanceof Error ? error.message : String(error);
  const message = pg instanceof Error ? pg.message : String(pg);
  const fields = (["code", "table", "column", "constraint", "detail"] as const)
    .filter((k) => typeof pg[k] === "string" && pg[k] !== "")
    .map((k) => `${k}: ${String(pg[k])}`);
  return fields.length ? `${message} (${fields.join(", ")})` : message;
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
 * `onRowFailed` and skipped. Other errors are rethrown.
 */
export async function writeIsolated<T, R>(
  items: T[],
  write: (batch: T[]) => Promise<R[]>,
  onRowFailed: (item: T, error: unknown) => void,
): Promise<{ results: R[]; failed: T[] }> {
  const results: R[] = [];
  const failed: T[] = [];
  const attempt = async (batch: T[]): Promise<void> => {
    if (!batch.length) return;
    try {
      results.push(...(await write(batch)));
    } catch (error) {
      if (!isRowLevelError(error)) throw error;
      if (batch.length === 1) {
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
  return { results, failed };
}
