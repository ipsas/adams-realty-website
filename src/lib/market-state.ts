import { sql, type SQL } from "drizzle-orm";
import { listings } from "@/db/schema";
import { MARKET_STATE_SPELLINGS } from "@/lib/state-name";

// The pure part lives in src/lib/state-name.ts (no database, so client code can use it).
export { MARKET_STATE_SPELLINGS, isMarketState, normalizeState } from "@/lib/state-name";

/** SQL twin of `isMarketState`, for listing queries. */
export function inMarketState(): SQL {
  return sql`upper(btrim(${listings.state})) in (${sql.join(
    MARKET_STATE_SPELLINGS.map((s) => sql`${s}`),
    sql`, `,
  )})`;
}
