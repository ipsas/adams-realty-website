import { useSyncExternalStore } from "react";
import { STORE_KEYS, useLocalValue } from "@/lib/local-store";
import {
  type ResolvedTheme,
  type ThemePref,
  SYSTEM_DARK_QUERY,
  parseThemePref,
  readResolvedTheme,
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

/**
 * The resolved theme for client-only widgets (the maps, both `ssr:false`): the live value
 * once hydrated, and before that the synchronous read, so the first render already has the
 * right answer instead of null.
 */
export function useClientTheme(): ResolvedTheme {
  return useResolvedTheme() ?? readResolvedTheme();
}

/** Print media: `print` while the page is being printed (or print is emulated). */
export const PRINT_QUERY = "print";

/**
 * The theme a map should draw: the page's theme on screen, and light while printing, since
 * printouts are always light (globals.css). See `markDrawnStyle` for the print fallback.
 */
export function useMapTheme(): ResolvedTheme {
  const printing = useMediaQuery(PRINT_QUERY, false);
  const theme = useClientTheme();
  return printing ? "light" : theme;
}
