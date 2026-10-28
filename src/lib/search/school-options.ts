import { and, eq, inArray, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db, type Executor } from "@/db";
import { listings } from "@/db/schema";
import { LISTINGS_TAG } from "@/lib/listings/cache-tags";
import { publicConditions } from "@/lib/listings/visibility";
import { inMarketState } from "@/lib/market-state";
import { schoolKeySql } from "./query";
import {
  formatSchoolName,
  isPlaceholderSchool,
  PLACEHOLDER_SCHOOL_KEYS,
  SCHOOL_LEVELS,
  schoolKey,
  type SchoolLevel,
} from "./school-name";

export type SchoolOptions = Record<SchoolLevel, string[]> & {
  /** Some for-sale listings still lack a school at a level, so the filters may miss homes. */
  partial: boolean;
};

const EMPTY: SchoolOptions = { elementary: [], middle: [], high: [], partial: false };

/**
 * The school filters' suggestions: each level's schools named by public listings in the
 * market's state, one per `schoolKey` (placeholders left out), shown as the most common
 * spelling formatted. `partial` when under 98% of the active and coming-soon sales there
 * name all three. Exported for tests; the route uses the cached `getSchoolOptions`.
 */
export async function schoolOptionsQuery(db: Executor): Promise<SchoolOptions> {
  const { rows } = await db.execute<{ level: SchoolLevel; raw: string; n: number }>(sql`
    select v.level, v.raw, count(*)::int as n
    from ${listings}
    cross join lateral (values ${sql.join(
      SCHOOL_LEVELS.map((l) => {
        const level = sql.raw(`'${l}'`);
        return sql`(${level}, ${listings.schools}->>${level})`;
      }),
      sql`, `,
    )}) as v(level, raw)
    where ${and(...publicConditions(), inMarketState())} and v.raw is not null
    group by v.level, v.raw`);

  const out: SchoolOptions = { elementary: [], middle: [], high: [], partial: false };
  for (const level of SCHOOL_LEVELS) {
    // key → its spellings' counts
    const byKey = new Map<string, { raw: string; n: number }[]>();
    for (const r of rows) {
      if (r.level !== level || isPlaceholderSchool(r.raw)) continue;
      const key = schoolKey(r.raw);
      byKey.set(key, [...(byKey.get(key) ?? []), { raw: r.raw, n: Number(r.n) }]);
    }
    out[level] = [...byKey.values()]
      .map((spellings) => {
        const top = spellings.sort((a, b) => b.n - a.n || a.raw.localeCompare(b.raw, "en-US"))[0];
        return formatSchoolName(top.raw);
      })
      .sort((a, b) => a.localeCompare(b, "en-US"));
  }

  const filled = and(
    ...SCHOOL_LEVELS.map(
      (l) =>
        sql`coalesce(${schoolKeySql(l)}, '') not in (${sql.join(
          PLACEHOLDER_SCHOOL_KEYS.map((k) => sql`${k}`),
          sql`, `,
        )})`,
    ),
  );
  const [coverage] = await db
    .select({
      total: sql<number>`count(*)::int`,
      filled: sql<number>`(count(*) filter (where ${filled}))::int`,
    })
    .from(listings)
    .where(
      and(
        ...publicConditions(),
        eq(listings.transactionType, "sale"),
        inArray(listings.status, ["active", "coming_soon"]),
        inMarketState(),
      ),
    );
  const total = Number(coverage?.total ?? 0);
  out.partial = total > 0 && Number(coverage.filled) / total < 0.98;
  return out;
}

// Like bedroom-on-main-updating.ts: the sync's LISTINGS_TAG revalidation clears it, and
// outside production the cache is skipped.
const cached = unstable_cache(() => schoolOptionsQuery(db), ["school-options"], {
  tags: [LISTINGS_TAG],
  revalidate: 300,
});

/** The cached school options; empty on any error, so the filters stay free text. */
export async function getSchoolOptions(): Promise<SchoolOptions> {
  try {
    return await (process.env.NODE_ENV === "production" ? cached() : schoolOptionsQuery(db));
  } catch (e) {
    console.warn("[search] school options failed", e);
    return EMPTY;
  }
}
