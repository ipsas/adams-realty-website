import { useSyncExternalStore } from "react";
import { STORE_KEYS, useLocalValue } from "@/lib/local-store";
import {
  type ResolvedTheme,
  type ThemePref,
  SYSTEM_DARK_QUERY,
  parseThemePref,
  resolveTheme,
} from "@/lib/theme";
import { useMediaQuery } from "@/lib/use-media-query";

/** The stored appearance choice, live across tabs. "system" on the server and during hydration. */
export function useThemePref(): ThemePref {
  return parseThemePref(useLocalValue<unknown>(STORE_KEYS.theme, null));
}

const noop = () => () => {};

/** The theme actually showing, or null on the server and during hydration (unknown there). */
export function useResolvedTheme(): ResolvedTheme | null {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const pref = useThemePref();
  const systemDark = useMediaQuery(SYSTEM_DARK_QUERY, false);
  return hydrated ? resolveTheme(pref, systemDark) : null;
}
