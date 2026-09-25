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
