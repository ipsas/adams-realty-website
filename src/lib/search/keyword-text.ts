import { sql, type SQL } from "drizzle-orm";
import { redactAccessCodes } from "@/lib/listings/excluded-fields";

/** The listing fields keyword search (`kw`) matches. Missing reads as empty. */
export type KeywordFields = {
  addressLine1?: string | null;
  city?: string | null;
  postalCode?: string | null;
  neighborhood?: string | null;
  mlsNumber?: string | null;
  headline?: string | null;
  propertySubType?: string | null;
  description?: string | null;
  features?: unknown;
};

/** Must match the columns of the listings_keyword_tsv_stale trigger (drizzle/0024). */
export const KEYWORD_FIELDS = [
  "addressLine1",
  "city",
  "postalCode",
  "neighborhood",
  "mlsNumber",
  "headline",
  "propertySubType",
  "description",
  "features",
] as const satisfies readonly (keyof KeywordFields)[];

/**
 * The text `listings.keyword_tsv` indexes: the listing's text as shown, so a
 * keyword search can't confirm a lockbox code. The description and each string
 * anywhere in `features` (never its keys) are masked on their own with the
 * listing page's masker, then "/" is read as a space (the parser takes
 * "room/kitchen/dining" or "Washer/Dryer" as one word). A change here (or to the
 * masker) needs a migration resetting keyword_tsv, as drizzle/0024 does.
 */
export function keywordText(l: KeywordFields): string {
  const parts = [
    l.addressLine1,
    l.city,
    l.postalCode,
    l.neighborhood,
    l.mlsNumber,
    l.headline,
    l.propertySubType,
    l.description == null ? null : redactAccessCodes(l.description),
    ...featureStrings(l.features).map(redactAccessCodes),
  ];
  return parts
    .filter((p): p is string => !!p)
    .join(" ")
    .replaceAll("/", " ");
}

/** `keyword_tsv`'s value for `keywordText`'s output. */
export function keywordTsv(text: string): SQL {
  return sql`to_tsvector('english', ${text}::text)`;
}

function featureStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(featureStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(featureStrings);
  return [];
}
