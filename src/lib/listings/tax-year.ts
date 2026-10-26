/**
 * A listing's tax year, or null when it isn't plausible: 2-digit years (24)
 * are 2000+; anything outside 1900…next year is noise. Used by the MLS mapper
 * and at display, since rows stored before the mapper fix can hold 2-digit years.
 */
export function normalizeTaxYear(v: unknown, now: Date = new Date()): number | null {
  let y =
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : null;
  if (y === null || !Number.isInteger(y)) return null;
  if (y >= 0 && y <= 99) y += 2000;
  return y >= 1900 && y <= now.getFullYear() + 1 ? y : null;
}
