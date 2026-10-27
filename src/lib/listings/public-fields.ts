import { getTableColumns } from "drizzle-orm";
import { listings } from "@/db/schema";

/**
 * Georgia MLS Rules & Regulations Art. V: no offer of compensation to buyer
 * brokers through MLS data. The mapper and sync still store these fields, but
 * no public page, payload or query carries them (and no staff dashboard view
 * shows them).
 */
export const COMPENSATION_FIELDS = [
  "variableCompensation",
  "buyerAgencyCompensation",
  "compensationComments",
] as const;

type CompensationField = (typeof COMPENSATION_FIELDS)[number];

/** A copy of `row` (a listing, or a column map to select) without the compensation fields. */
export function omitCompensation<T extends object>(row: T): Omit<T, CompensationField> {
  const out = { ...row } as Record<string, unknown>;
  for (const k of COMPENSATION_FIELDS) delete out[k];
  return out as Omit<T, CompensationField>;
}

/** A listing's columns for public pages (the property page): every column but the compensation fields. */
export const publicListingColumns = omitCompensation(getTableColumns(listings));
