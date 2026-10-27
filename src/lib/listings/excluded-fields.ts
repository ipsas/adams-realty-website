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
 * "combo" only with a code ("Combo 1234", "combo lock"), not a "Washer/Dryer Combo". */
const ACCESS_WORDS = String.raw`lock\s*box|alarm\s+code|gate\s+code|access\s+code|door\s+code|showing\s+instructions?|key\s+under`;
const RESTRICTED_VALUE = new RegExp(
  String.raw`\b(?:${ACCESS_WORDS}|combo\b[\s:#=-]*(?:code|lock|\d))`,
  "i",
);

/**
 * An access code in free text: a code phrase, then separators (":", "#", "=", "-") and at
 * most two filler words ("is", "box", "entry"), then the whole code: 2-16 digits, spaced or
 * dashed digit groups ("1234 5678", "12-34-56", "1 2 3 4"), spelled-out numbers ("one two",
 * "twelve thirty four") or a code of letters and digits ("A12B"). "key under ..." masks the
 * hiding place. Group 1 (or 2) is what stays visible.
 *
 * - A strong phrase ("gate code", "lockbox code", "combo lock") takes any code, and may
 *   reach one up to six plain words later ("gate code for the entrance is 4455"), with
 *   no punctuation in between and only a code a weak phrase would take, never a year
 *   ("garage code compliant 2021").
 * - A weak phrase ("alarm", "lockbox", "keypad", "Supra", "combination") takes neither a
 *   lone 2-digit number nor fewer than three spelled-out digits ("alarm one of the best").
 * - A plain "combo" ("dining combo, 2-car garage") is a phrase only right before ":", "=",
 *   "#", "is", a dashed or a 4-digit code, and never before a year ("combo 2018 remodel").
 * - A plain "code" is a phrase before ":", "=", "#", "is" (and then takes 1-2 spelled-out
 *   digits, but no 2-digit number) or a 3+ digit number, but not after "zoning", "zip",
 *   "area" and the like.
 * - `NOT_CODE_START` is never a code: a code year ("2018 IBC"), a year of work ("2019
 *   renovated") or a size ("20x30"). A number of units ("1234 sqft", "12 ac") right after
 *   a code phrase is the code ("gate code 4455 feet from road" masks 4455).
 * - `NOT_CODE` is never part of a code, after its first digit group: those, or a number of
 *   units ("Keypad 1234 12 acres", "gate code 1234 2400 sqft"). A number starting with 0
 *   is never a size.
 *
 * Postgres prefers the longest match where JS takes the first alternative that matches,
 * so alternatives are ordered longest first, and the words a phrase may skip are letters
 * only and never a spelled-out digit, so the code starts at the same place in both.
 * `\b` is the only word-boundary escape used, so the same pattern runs in Postgres
 * (`\y`) for keyword search (`ACCESS_CODE_PG`).
 */
// Teens and tens before the digits they start with ("seventeen", "seventy", "seven").
const DIGIT_WORD = String.raw`(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b`;
/** A building-code year ("2018 IBC", "2015 edition") is a reference, not a code. */
const YEAR = String.raw`(?:19|20)\d\d\b`;
const CODE_YEAR = String.raw`(?:19|20)\d\d\s+(?:ibc|irc|nec|iecc|building\s+code|code\s+compliant|edition)\b`;
const WORK_YEAR = String.raw`(?:19|20)\d\d\s+(?:remodel|renovat|update|addition|install|built|build)`;
// A size never starts with 0 ("gate code 0581 SF" is a code).
const DIMENSION = String.raw`[1-9]\d*\s*x\s*\d`;
const UNIT = String.raw`acres?|sq|sqft|sf|square\s+f(?:ee|oo)t|ft|feet|foot|car|beds?|bedrooms?|baths?|story|stories|miles?|min|hrs?|hours?`;
// "ac" is acres only after a small number and before punctuation or the end ("2 ac."):
// "gate code 1234 AC unit" is a code, then an air conditioner.
const ACRES_AC = String.raw`[1-9]\d{0,2}\s*ac\b(?=\s*(?:[.,;:)]|$))`;
// Right after a code phrase a number with a unit is still the code ("lockbox code 0581 SF",
// "gate code 4455 feet from road"): only a year or a dimension stops it there.
const NOT_CODE_START = String.raw`${CODE_YEAR}|${WORK_YEAR}|${DIMENSION}`;
const NOT_CODE = String.raw`${NOT_CODE_START}|[1-9]\d*\s*(?:${UNIT})\b|${ACRES_AC}`;
const COMBO_YEAR = String.raw`\s*(?:[:=#]\s*|is\s+)?${YEAR}`;
const STRONG = [
  String.raw`lock\s*box[\s-]+(?:code|combo)`,
  String.raw`(?:alarm|gate|garage|door|access|cbs)[\s-]*code`,
  String.raw`comb(?:o|ination)[\s-]+lock`,
].join("|");
const CODE = String.raw`(?<!(?:zoning|building|fire|zip|postal|area|county|tax|promo)[\s-])code(?=\s*(?:[:=#]|is\b)|\s+\d{3})`;
const WEAK = [
  String.raw`lock\s*box`,
  "alarm",
  "keypad",
  "supra",
  "cbs",
  String.raw`(?<!(?:dining|living|kitchen|dryer|washer|family|breakfast)\s)comb(?:o|ination)(?!${COMBO_YEAR})(?=\s*(?:[:=#]|is\b|\d{1,4}(?:-\d{1,4}){2}|\d{4}))`,
].join("|");
const FILLER = "is|box|code|combo|entry|number|num|no|pin";
const SEP = String.raw`[\s:#=-]*(?:(?:${FILLER})\b[\s:#=.-]*){0,2}`;
const REACH = String.raw`(?:\s+(?!${DIGIT_WORD})[a-z]+\b){1,6}`;
// What a weak phrase takes: 3+ digits, digit groups, letters and digits, 3+ spelled digits.
const WEAK_CODE = String.raw`(?=\d{3}|\d{1,2}[\s-]\d|\d{1,2}[a-z]|[a-z]+\d|${DIGIT_WORD}[\s-]+${DIGIT_WORD}[\s-]+${DIGIT_WORD})`;
const CODE_CODE = String.raw`(?=\d{3}|\d{1,2}[\s-]\d|\d{1,2}[a-z]|[a-z])`;
const PREFIX = String.raw`\b(?:(?:${STRONG})\b(?:${SEP}|${REACH}${SEP}(?!${YEAR})${WEAK_CODE})|${CODE}\b${SEP}${CODE_CODE}|(?:${WEAK})\b${SEP}${WEAK_CODE})`;
// Digit groups: "1234 5678" or "12-34 56" (a lone digit after a space is not part of the
// code: "alarm 1234 2 car garage"), dashed "1-2-3-4", or single digits "1 2 3 4".
const TOKEN = [
  String.raw`\d{2,16}(?:[\s-](?!${NOT_CODE})\d{2,16}){1,9}`,
  String.raw`\d{1,16}(?:-\d{1,16}){1,9}`,
  String.raw`\d(?:\s\d){2,15}`,
  String.raw`\d{2,16}`,
  String.raw`${DIGIT_WORD}(?:[\s-]+${DIGIT_WORD}){0,9}`,
  // Letters and digits, but not an ordinal ("2nd").
  String.raw`(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])(?![0-9]+(?:st|nd|rd|th)\b)[0-9a-z]{3,12}`,
].join("|");
const ACCESS_CODE_SOURCE = String.raw`(${PREFIX})(?!${NOT_CODE_START})(?:${TOKEN})#?(?![0-9a-z]|-\d)|(\bkey\s+under\s+)[^.,;!?\n]{1,40}`;
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

/**
 * Public remarks with any access code masked ("gate code 4455" reads "gate code ****").
 * listings.keyword_tsv stores its output: a change here needs a KEYWORD_TSV_VERSION bump
 * (src/lib/search/keyword-text.ts), or stored vectors keep what it used to let through.
 */
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
