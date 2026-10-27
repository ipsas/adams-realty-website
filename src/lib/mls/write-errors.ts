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

/** The standard wording of a 23514 on a table; anything else (a domain's, a trigger's) is dropped. */
const CHECK_MESSAGE = /^new row for relation "[^"]*" violates check constraint( "[^"]*")?$/;

/**
 * A data exception's message (SQLSTATE class 22) quotes the offending value,
 * e.g. `invalid input syntax for type integer: "abc"`: everything from its
 * first to its last double quote goes, except in an encoding error (22021,
 * 22P05), which quotes the encoding's name and shows the value as bytes: the
 * bytes go. A 28xxx names the user; a P0001 (`raise exception`) and an
 * unrecognized 23514 can say anything. Other classes quote only identifiers.
 */
function redactMessage(message: string, code: unknown): string {
  if (typeof code !== "string") return message;
  if (code === "22021" || code === "22P05") {
    return message.replace(/0x[0-9a-f]{2}(\s+0x[0-9a-f]{2})*/gi, REDACTED);
  }
  if (code.startsWith("22")) return message.replace(/"[\s\S]*"/, `"${REDACTED}"`);
  if (code.startsWith("28")) return message.replace(/user "[^"]*"/g, `user "${REDACTED}"`);
  if (code === "P0001") return "Database raised an exception";
  if (code === "23514" && !CHECK_MESSAGE.test(message)) return "Check constraint violated";
  return message;
}

/** Longest message describeError shows for an error that isn't a Postgres one. */
export const MAX_ERROR_LENGTH = 200;

/**
 * An error raised by the sync itself, whose message we wrote and which holds
 * no feed or row values: describeError shows it as it is.
 */
export class SyncError extends Error {}

/**
 * Errors whose message is ours and already safe to show: the sync's own, an
 * unstorable row's (InvalidRowError names only the listing, the field and
 * the number), and the RESO client's (which redacts its URLs' tokens).
 */
function isSafeError(e: unknown): e is Error {
  return (
    e instanceof SyncError ||
    e instanceof InvalidRowError ||
    (e instanceof Error && /^RESO (request|feed|client|data source) /.test(e.message))
  );
}

/**
 * Any other error's message can quote a value (a TypeError's `Cannot read
 * properties of undefined (reading 'x')`, a driver's): quoted substrings go,
 * and the rest is cut to MAX_ERROR_LENGTH, behind the error's name.
 */
function redactUnknown(e: unknown): string {
  // Before the cut, so a cut-off address can't slip past redactPersonal.
  const text = redactPersonal(
    (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).replace(
      /(?<!\w)('[^'\n]*'|"[^"\n]*"|`[^`\n]*`)/g,
      (quoted) => `${quoted[0]}${REDACTED}${quoted[0]}`,
    ),
  );
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

/** An email address; not a URL's `user@host` (nothing before it may be part of one). */
const EMAIL = /(?<![\w.%+\-:/])[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;

const STREET_SUFFIXES =
  "St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Hwy|Highway|Blvd|Way|Pkwy|Cir";

/**
 * A street address, conservatively: a house number, 1–4 words, then a street
 * suffix as written ("St") or in capitals ("ST"), so "3 runs the way" isn't one.
 */
const STREET_ADDRESS = new RegExp(
  String.raw`\b\d{1,6}[A-Za-z]?(?:\s+[A-Za-z0-9'.-]+){1,4}?\s+` +
    String.raw`(?:${STREET_SUFFIXES}|${STREET_SUFFIXES.toUpperCase()})\b\.?`,
  "g",
);

/** `text` with its email addresses and street addresses replaced by placeholders. */
export function redactPersonal(text: string): string {
  return text.replace(EMAIL, "[email]").replace(STREET_ADDRESS, "[address]");
}

/**
 * The real reason a write failed, for logs, the run record, the dashboard and
 * the cron response: the Postgres message with its code, table, column,
 * constraint and detail, with row values redacted (redactMessage, redactDetail).
 * Drizzle wraps driver errors in "Failed query: <sql> params: <values>" with
 * the cause as `.cause`; that wrapper (a whole page's SQL and values) is
 * skipped, as is any other wrapper around a Postgres error (SyncFailedError).
 * Any other error shows as it is only when it's ours (isSafeError), otherwise
 * redacted (redactUnknown). Whatever it returns has its email and street
 * addresses redacted (redactPersonal).
 */
export function describeError(error: unknown): string {
  return redactPersonal(describeUnredacted(error));
}

function describeUnredacted(error: unknown): string {
  const pg = pgError(error);
  if (!pg) {
    const inner = causeChain(error).find((e) => !(e instanceof DrizzleQueryError));
    if (inner === undefined) return "Database query failed";
    return isSafeError(inner) ? inner.message : redactUnknown(inner);
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

/**
 * A page fails whole when every row, or more than this fraction of its rows, is rejected…
 * Its rows are those handed to the database write: records the mapper skipped
 * (MapSkipReason) count neither as rows nor as rejected.
 */
export const MAX_REJECTED_FRACTION = 0.5;
/**
 * …provided it has at least this many rows (written or rejected; mapper-skipped
 * records not counted). A smaller page never fails: its rejected rows are
 * skipped even when all are, so a lone permanently bad record can't stall the
 * incremental sync.
 */
export const MIN_ROWS_FOR_REJECTED_FRACTION = 10;

/**
 * A page that failed with PageRejectedError at the same cursor this many runs
 * in a row is written on the next run regardless: its rejected rows are
 * quarantined (sync_quarantine) and the cursor moves past it, so a page of bad
 * records can't stall the sync forever. Runs 1–3 at a cursor fail; run 4 quarantines.
 */
export const QUARANTINE_AFTER_FAILURES = 3;

/**
 * So many of a page's rows were rejected that the cause is systemic (a schema
 * mismatch, a mapper bug), not a bad record: the page must not be written, nor
 * the cursor moved past it (until QUARANTINE_AFTER_FAILURES runs failed on it).
 */
export class PageRejectedError extends SyncError {
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
 * A run quarantines at most this many records. A page whose rejected rows
 * would take the run past it is not quarantined at first: the run fails with
 * QuarantineRefusedError (admins are emailed) and the cursor stays put, so a
 * feed whose records are nearly all rejected can't drain into sync_quarantine
 * unnoticed. The refusal is bounded: on the QUARANTINE_ESCALATE_AT_REFUSAL-th
 * refusal at the same cursor the page is quarantined regardless of this cap.
 * It must stay above MAX_REJECTED_FRACTION of the feed's page size (200
 * records: a page fails with 101 rejected), or no full page could ever be
 * quarantined without that escalation.
 */
export const QUARANTINE_MAX_PER_RUN = 150;

/**
 * The refusal (QuarantineRefusedError) at one cursor that is not held but
 * escalated: the page is quarantined anyway, past QUARANTINE_MAX_PER_RUN and
 * even when every row was rejected, and the cursor moves on. Refusals 1–3
 * hold the page (about an hour at the 15-minute cron), each emailing the
 * admins; the 4th quarantines it and emails them that it did. Counted in the
 * source's rejection streak (RejectionStreak), so it survives across runs.
 */
export const QUARANTINE_ESCALATE_AT_REFUSAL = 4;

/**
 * A page due for quarantine that must not be, yet: too many rejected rows for
 * the run (QUARANTINE_MAX_PER_RUN), or every row of it (at least
 * MIN_ROWS_FOR_REJECTED_FRACTION) rejected, which means a schema or feed
 * problem, not bad records. Nothing of the page is written or quarantined and
 * the cursor stays; the run fails and admins are emailed. Bounded: the
 * QUARANTINE_ESCALATE_AT_REFUSAL-th refusal at the same cursor quarantines
 * the page anyway (writeIsolated's `escalate`), so the sync can't stall forever.
 * `firstErrorClass` (errorClass) names the first rejection's kind, with no values.
 */
export class QuarantineRefusedError extends SyncError {
  constructor(
    readonly rejected: number,
    readonly total: number,
    why: string,
    firstReason: string,
    readonly firstErrorClass: string,
  ) {
    super(
      `${rejected} of ${total} rows rejected on a page due for quarantine; ${why}, so nothing ` +
        `was quarantined and the cursor stays. First error: ${firstReason}`,
    );
    this.name = "QuarantineRefusedError";
  }
}

/**
 * What kind of error rejected a row, with no row values, listing keys or
 * messages: the SQLSTATE of a Postgres error (with its constraint, column
 * and table names), the fields of an InvalidRowError, else the error's name.
 * For alerts (email), where describeError's detail isn't wanted.
 */
export function errorClass(error: unknown): string {
  const pg = pgError(error);
  if (pg) {
    const names = (["table", "column", "constraint"] as const)
      .map((k) => (typeof pg[k] === "string" && pg[k] !== "" ? `${k} ${pg[k]}` : null))
      .filter((n) => n !== null);
    return redactPersonal(
      `Postgres error ${String(pg.code)}${names.length ? ` (${names.join(", ")})` : ""}`,
    );
  }
  const invalid = causeChain(error).find((e) => e instanceof InvalidRowError);
  if (invalid) {
    const fields = [...new Set(invalid.issues.map((i) => i.field))].join(", ");
    return redactPersonal(`InvalidRowError (${fields})`);
  }
  const inner = causeChain(error).find((e) => !(e instanceof DrizzleQueryError));
  return redactPersonal(inner instanceof Error ? inner.name : "Unknown error");
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
 * good record is written, and each one that fails alone is skipped. Other
 * errors are rethrown. When there are at least MIN_ROWS_FOR_REJECTED_FRACTION
 * records and every one, or more than MAX_REJECTED_FRACTION of them, fails,
 * throws PageRejectedError (unless `opts.allowRejected`: the page is being
 * quarantined): the caller's transaction must then roll back the records that
 * were written. Fewer records never throw, even if all fail. A quarantined
 * page throws QuarantineRefusedError instead when every one of at least
 * MIN_ROWS_FOR_REJECTED_FRACTION records fails, or more than
 * `opts.maxQuarantined` do, unless `opts.escalate` (the refusal was escalated:
 * QUARANTINE_ESCALATE_AT_REFUSAL): then it never refuses. `items` are the
 * page's records handed to the database: the base of the fraction.
 * `onRowFailed` is called for each skipped record only once the page is known
 * not to throw; a caller in a transaction should still hold its logs until it
 * commits.
 */
export async function writeIsolated<T, R>(
  items: T[],
  write: (batch: T[]) => Promise<R[]>,
  onRowFailed: (item: T, error: unknown) => void,
  opts: { allowRejected?: boolean; maxQuarantined?: number; escalate?: boolean } = {},
): Promise<{ results: R[]; failed: T[] }> {
  const results: R[] = [];
  const failed: T[] = [];
  const errors: unknown[] = [];
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
        errors.push(error);
        return;
      }
      const mid = Math.ceil(batch.length / 2);
      await attempt(batch.slice(0, mid));
      await attempt(batch.slice(mid));
    }
  };
  await attempt(items);
  if (
    !opts.allowRejected &&
    items.length >= MIN_ROWS_FOR_REJECTED_FRACTION &&
    (failed.length === items.length || failed.length > items.length * MAX_REJECTED_FRACTION)
  ) {
    throw new PageRejectedError(failed.length, items.length, describeError(firstError));
  }
  if (opts.allowRejected && !opts.escalate && failed.length) {
    const why =
      items.length >= MIN_ROWS_FOR_REJECTED_FRACTION && failed.length === items.length
        ? "the whole page was rejected (a schema or feed problem?)"
        : opts.maxQuarantined !== undefined && failed.length > opts.maxQuarantined
          ? `more than the run's quarantine cap allows (${opts.maxQuarantined} left of ${QUARANTINE_MAX_PER_RUN})`
          : null;
    if (why) {
      throw new QuarantineRefusedError(
        failed.length,
        items.length,
        why,
        describeError(firstError),
        errorClass(firstError),
      );
    }
  }
  failed.forEach((item, i) => onRowFailed(item, errors[i]));
  return { results, failed };
}
