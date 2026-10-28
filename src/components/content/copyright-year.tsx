"use client";

import { createContext, useContext, type ReactNode } from "react";
import { mlsCopyright, mlsCopyrightShort } from "@/lib/mls-copyright";

/**
 * The copyright year, computed once on the server (src/app/layout.tsx), so the
 * client renders the same year as the server even across New Year's (React
 * #418). Without a provider, this year.
 */
const CopyrightYear = createContext<number | null>(null);

export function CopyrightYearProvider({ year, children }: { year: number; children?: ReactNode }) {
  return <CopyrightYear.Provider value={year}>{children}</CopyrightYear.Provider>;
}

export function useCopyrightYear(): number {
  return useContext(CopyrightYear) ?? new Date().getFullYear();
}

/** `mlsCopyright` for the provided year, as plain text. */
export function MlsCopyright() {
  return <>{mlsCopyright(useCopyrightYear())}</>;
}

/** `mlsCopyrightShort` for the provided year, as plain text. */
export function MlsCopyrightShort() {
  return <>{mlsCopyrightShort(useCopyrightYear())}</>;
}
