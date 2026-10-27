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

/** A copy of `fields` (a listing's features) without any excluded key. */
export function withoutExcludedFields<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([k]) => !isExcludedField(k))) as T;
}
