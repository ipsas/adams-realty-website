"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Today's market date (YYYY-MM-DD), computed once on the server
 * (src/app/layout.tsx), so the client decides "New" badges on the same day as
 * the server even when the browser's clock differs (React #418). Without a
 * provider, null.
 */
const MarketToday = createContext<string | null>(null);

export function MarketTodayProvider({ today, children }: { today: string; children?: ReactNode }) {
  return <MarketToday.Provider value={today}>{children}</MarketToday.Provider>;
}

export function useMarketToday(): string | null {
  return useContext(MarketToday);
}
