/**
 * Listing statuses the public site never shows, for any listing: Georgia MLS
 * forbids them for its feed (IDX agreement Exhibit A §17; On Hold is stored as
 * `withdrawn`), and the firm hides its own the same way. Import-free so client
 * components can use it; `visibility.ts` checks it against the status enum and
 * the `idx_hidden` column mirrors it.
 */
export const HIDDEN_STATUSES = ["coming_soon", "withdrawn", "expired", "canceled"] as const;
