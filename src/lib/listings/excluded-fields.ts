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

/**
 * An access code in free text: an explicit code phrase ("gate code", "lockbox", "Supra",
 * "code:"), then only separators (":", "#", "=") and at most two filler words ("is",
 * "box", "combo"), then the whole code: 3-10 digits, spaced or dashed digit groups
 * ("1234 5678", "12-34-56", "1 2 3 4"), spelled-out digits ("one two three four") or a
 * short code of letters and digits ("A12B"). A plain "combo" ("dining combo, 2-car
 * garage") or "code" is a phrase only right before ":", "=", "#" or "is" ("combo" also
 * before a dashed or 4-digit code), and "lockbox on front door" has no code. A code-year
 * reference ("code is 2018 IBC") is not a code. "key under ..." masks the hiding place.
 * Group 1 (or 2) is what stays visible.
 *
 * `\b` is the only word-boundary escape used, so the same pattern runs in Postgres
 * (`\y`) for keyword search (`ACCESS_CODE_PG`).
 */
const PHRASE = [
  String.raw`lock\s*box(?:\s+(?:code|combo))?`,
  String.raw`(?:alarm|gate|garage|door|access|cbs)[\s-]*code`,
  "alarm",
  "keypad",
  "supra",
  "cbs",
  String.raw`(?<!(?:dining|living|kitchen|dryer|washer|family|breakfast)\s)combo(?=\s*(?:[:=#]|is\b|\d{1,4}(?:-\d{1,4}){2}|\d{4}))`,
  String.raw`code(?=\s*(?:[:=#]|is\b))`,
].join("|");
const FILLER = "is|box|code|combo|number|num|no|pin";
const SEP = String.raw`[\s:#=]*(?:(?:${FILLER})\b[\s:#=.]*){0,2}`;
const DIGIT_WORD = "zero|one|two|three|four|five|six|seven|eight|nine";
// Digit groups: "1234 5678" or "12-34 56" (a lone digit after a space is not part of the
// code: "alarm 1234 2 car garage"), dashed "1-2-3-4", or single digits "1 2 3 4".
const TOKEN = [
  String.raw`\d{2,10}(?:[\s-]\d{2,10}){1,9}`,
  String.raw`\d{1,10}(?:-\d{1,10}){1,9}`,
  String.raw`\d(?:\s\d){2,9}`,
  String.raw`\d{3,10}`,
  String.raw`(?:${DIGIT_WORD})(?:[\s-]+(?:${DIGIT_WORD})){2,9}`,
  // Letters and digits, but not an ordinal ("2nd").
  String.raw`(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])(?![0-9]+(?:st|nd|rd|th)\b)[0-9a-z]{3,8}`,
].join("|");
/** A building-code year ("2018 IBC", "2015 edition") is a reference, not a code. */
const CODE_YEAR = String.raw`(?:19|20)\d\d\s+(?:ibc|irc|nec|iecc|building\s+code|code\s+compliant|edition)\b`;
const ACCESS_CODE_SOURCE = String.raw`(\b(?:${PHRASE})\b${SEP})(?!${CODE_YEAR})(?:${TOKEN})#?(?![0-9a-z]|-\d)|(\bkey\s+under\s+)[^.,;!?\n]{1,40}`;
const ACCESS_CODE = new RegExp(ACCESS_CODE_SOURCE, "gi");
const HAS_ACCESS_CODE = new RegExp(ACCESS_CODE_SOURCE, "i");
const MASK = "****";

/** `ACCESS_CODE` for Postgres: `regexp_replace(text, ACCESS_CODE_PG, ACCESS_CODE_PG_REPLACEMENT, 'gi')`. */
export const ACCESS_CODE_PG = ACCESS_CODE_SOURCE.replaceAll(String.raw`\b`, String.raw`\y`);
export const ACCESS_CODE_PG_REPLACEMENT = String.raw`\1\2` + MASK;

/** Whether a free-text value ("Alarm code 1234", "Lockbox on porch", "Keypad 1234") must never be shown. */
export function isRestrictedValue(value: string): boolean {
  return RESTRICTED_VALUE.test(value) || HAS_ACCESS_CODE.test(value);
}

/** Public remarks with any access code masked ("gate code 4455" reads "gate code ****"). */
export function redactAccessCodes(text: string): string {
  return text.replace(ACCESS_CODE, `$1$2${MASK}`);
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
