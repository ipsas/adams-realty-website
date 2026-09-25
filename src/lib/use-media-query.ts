import { useCallback, useSyncExternalStore } from "react";

/**
 * The app-shell breakpoint: portrait phones and short landscape touch screens.
 * It must stay identical to `@custom-variant phone` in src/app/globals.css
 * (use-media-query.test.ts checks this), so JS and CSS never disagree about
 * which shell is showing.
 */
export const PHONE_QUERY = "(max-width: 767.98px), (pointer: coarse) and (max-height: 500px)";

/**
 * Live `matchMedia(query).matches`. Renders `serverDefault` on the server and
 * during hydration, then the real value, so markup never mismatches.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      if (mql.addEventListener) {
        mql.addEventListener("change", cb);
        return () => mql.removeEventListener("change", cb);
      }
      // Safari < 14.
      mql.addListener(cb);
      return () => mql.removeListener(cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(query).matches
        : serverDefault,
    () => serverDefault,
  );
}

/** True in the phone shell. False on the server: the SSR default is the desktop layout. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY, false);
}
