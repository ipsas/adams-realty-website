import { sql, type SQL } from "drizzle-orm";
import { site } from "@/config/site";
import { listings } from "@/db/schema";

/**
 * The market's state (Georgia). County names repeat across states (Jackson,
 * Madison, Hall), so anything county-scoped — county search, the firm's area,
 * the area guides — only ever counts listings in this state.
 *
 * `listings.state` is the feed's StateOrProvince; "GA" and "Georgia" in any
 * case or padding both count.
 */
export const MARKET_STATE_SPELLINGS = [site.market.state, site.market.stateName.toUpperCase()];

/** Whether a stored state is the market's; null or empty is not. */
export function isMarketState(state: string | null | undefined): boolean {
  const s = state?.trim().toUpperCase();
  return !!s && MARKET_STATE_SPELLINGS.includes(s);
}

/** SQL twin of `isMarketState`, for listing queries. */
export function inMarketState(): SQL {
  return sql`upper(btrim(${listings.state})) in (${sql.join(
    MARKET_STATE_SPELLINGS.map((s) => sql`${s}`),
    sql`, `,
  )})`;
}
