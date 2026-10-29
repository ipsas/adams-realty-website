/** Whitespace plus zero-width characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM) that render as nothing. */
const BLANK = /^[\s\u200B-\u200D\u2060\uFEFF]*$/;

/**
 * A tax parcel number as given, surrounding whitespace trimmed, or null when
 * it isn't a string or holds nothing visible. A non-empty value is otherwise
 * kept exactly, invisible characters included.
 */
export function cleanParcel(v: unknown): string | null {
  if (typeof v !== "string" || BLANK.test(v)) return null;
  return v.trim();
}
