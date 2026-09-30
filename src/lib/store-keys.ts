/**
 * Every localStorage key the app uses (lead-owned; add new keys here). React-free, so
 * server modules such as the root layout's theme script can import it; client code
 * gets the same object from `@/lib/local-store`.
 */
export const STORE_KEYS = {
  recentSearches: "ar:recentSearches",
  lastSearch: "ar:lastSearch",
  recentlyViewed: "ar:recentlyViewed",
  searchAsMove: "ar:searchAsMove",
  installDismissedAt: "ar:installDismissedAt",
  visitDays: "ar:visitDays",
  uid: "ar:uid",
  /** Appearance: the JSON string "light" or "dark"; no key means Match my device. */
  theme: "ar:theme",
} as const;
export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS];

/**
 * sessionStorage key prefixes (this tab only; they survive reloads and Back, not a new tab).
 * - searchPlace + "<path+query without the sheet view and save=>": where the results list was
 *   (scroll, tapped card, list or map), so Back and reload restore it (F13).
 * - returnTo + "<scope>": the list a detail page was opened from, so its "Back to …" link can
 *   act like Back (search, leads, dashboard listings).
 * - lastList + "<scope>": the last list URL of a dashboard scope, for that link's fallback.
 * - saveIntent (a whole key): the home a signed-out heart tap asked to save, as
 *   `{ id, at }`, so the `save=<id>` it adds to the sign-in return address saves that home
 *   only after that tap, in this tab, and only once (a shared `?save=` link saves nothing).
 */
export const SESSION_KEYS = {
  searchPlace: "ar:search:",
  returnTo: "ar:return:",
  lastList: "ar:list:",
  saveIntent: "ar:save-intent",
} as const;
