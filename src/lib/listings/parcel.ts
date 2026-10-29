import { canShowDetails } from "./visibility";

type ParcelSubject = Parameters<typeof canShowDetails>[0] & { parcelNumber: string | null };

/**
 * The tax parcel number to show on a listing's page, exactly as stored
 * (surrounding whitespace aside), or null: when blank, or when the display
 * rules hide the listing's details (`canShowDetails`).
 */
export function displayParcel(l: ParcelSubject): string | null {
  if (!canShowDetails(l)) return null;
  return l.parcelNumber?.trim() || null;
}
