import { COMPENSATION_FIELDS } from "./public-fields";

/**
 * Fields Georgia MLS forbids on public displays (IDX agreement, Exhibit C
 * "Mandatory Exclusion"), by their RESO names. The mapper reads none of them,
 * so they are never stored or rendered; mapper.test.ts proves it with a
 * record that carries every one.
 */
export const EXCLUDED_FIELDS = [
  "ListingAgreement",
  "ListingContractDate",
  "OnMarketDate",
  "ExpirationDate",
  "PrivateRemarks",
  "ShowingContactName",
  "ShowingContactPhone",
  "PrivateOfficeRemarks",
  "OfficeRemarks",
  "ShowingRequirements",
  "ShowingInstructions",
  // Showing instructions and property security (IDX Agreement §14; R&R Art. III-2 §12(b)).
  "LockBoxType",
  "LockBoxLocation",
  "LockBoxSerialNumber",
  "OccupantName",
  "OccupantPhone",
  "OccupantType",
  "OwnerName",
  "OwnerPhone",
  "AccessCode",
] as const;

/**
 * Every key that must never be shown as a listing detail: the Exhibit C fields
 * above, the RESO compensation fields (R&R Art. V) and our stored names for
 * them (COMPENSATION_FIELDS). The runtime guard behind `isExcludedField`.
 */
export const EXCLUDED_FIELD_KEYS = [
  ...EXCLUDED_FIELDS,
  "BuyerAgencyCompensation",
  "BuyerAgencyCompensationType",
  "BuyerAgencyCompensationComments",
  "CompensationComments",
  "DualVariableCompensationYN",
  "SubAgencyCompensation",
  "SubAgencyCompensationType",
  "TransactionBrokerCompensation",
  "TransactionBrokerCompensationType",
  ...COMPENSATION_FIELDS,
] as const;

/** "ShowingInstructions", "showing_instructions" and "Showing instructions" all read "showinginstructions". */
const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const EXCLUDED = EXCLUDED_FIELD_KEYS.map(normalize);

/**
 * Whether a field key or detail label names an excluded field, in any case or
 * spacing and with a vendor prefix ("GAMLS_ShowingInstructions").
 */
export function isExcludedField(key: string): boolean {
  const k = normalize(key);
  return EXCLUDED.some((x) => k === x || k.endsWith(x));
}

/**
 * Words that mark a free-text value as showing or access information (IDX Agreement §14;
 * R&R Art. III-2 §12(b)) whatever field carries it. "Alarm" alone ("Fire Alarm") is fine;
 * "combo" only with a code ("Combo 1234", "combo lock"), not a "Washer/Dryer Combo".
 */
const ACCESS_WORDS = String.raw`lock\s*box|alarm\s+code|gate\s+code|access\s+code|door\s+code|showing\s+instructions?|key\s+under`;
const RESTRICTED_VALUE = new RegExp(
  String.raw`\b(?:${ACCESS_WORDS}|combo\b[\s:#=-]*(?:code|lock|\d))`,
  "i",
);
/** An access word, up to 12 non-digit characters ("is", ": #"), then the code's digits. */
const ACCESS_CODE = new RegExp(
  String.raw`(\b(?:${ACCESS_WORDS}|combo)\b[^\d\n.]{0,12})\d(?:[\d-]*\d)?`,
  "gi",
);

/** Whether a free-text value ("Alarm code 1234", "Lockbox on porch") must never be shown. */
export function isRestrictedValue(value: string): boolean {
  return RESTRICTED_VALUE.test(value);
}

/** Public remarks with any access code masked ("gate code 4455" reads "gate code ****"). */
export function redactAccessCodes(text: string): string {
  return text.replace(ACCESS_CODE, "$1****");
}

/**
 * A copy of `fields` (a listing's features) without any excluded key, and without any
 * restricted value (`isRestrictedValue`) in its lists.
 */
export function withoutExcludedFields<T extends object>(fields: T): T {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([k]) => !isExcludedField(k))
      .map(([k, v]) => [
        k,
        Array.isArray(v)
          ? v.filter((x: unknown) => typeof x !== "string" || !isRestrictedValue(x))
          : v,
      ]),
  ) as T;
}
