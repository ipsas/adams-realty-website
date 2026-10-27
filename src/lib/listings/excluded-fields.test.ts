import { describe, expect, it } from "vitest";
import {
  EXCLUDED_FIELD_KEYS,
  EXCLUDED_FIELDS,
  isExcludedField,
  withoutExcludedFields,
} from "./excluded-fields";
import { COMPENSATION_FIELDS } from "./public-fields";

describe("excluded fields", () => {
  it("covers the Exhibit C fields, the RESO compensation fields and our stored ones", () => {
    for (const k of [...EXCLUDED_FIELDS, ...COMPENSATION_FIELDS, "BuyerAgencyCompensation"])
      expect(EXCLUDED_FIELD_KEYS).toContain(k);
  });

  it("matches any case, spacing or vendor prefix", () => {
    for (const k of [
      "ShowingInstructions",
      "showingInstructions",
      "showing_instructions",
      "Showing instructions",
      "GAMLS_ShowingInstructions",
      "LockBoxType",
      "lockboxType",
      "occupantPhone",
      "PrivateRemarks",
      "buyerAgencyCompensation",
      "Compensation comments",
      "variableCompensation",
      "DualVariableCompensationYN",
    ])
      expect(isExcludedField(k), k).toBe(true);
  });

  it("leaves ordinary fields alone", () => {
    for (const k of ["security", "Security", "accessibility", "Listing terms", "remarks", "levels"])
      expect(isExcludedField(k), k).toBe(false);
  });

  it("drops excluded keys from a feature map and keeps the rest", () => {
    expect(
      withoutExcludedFields({
        security: ["Smoke Detector(s)"],
        showingInstructions: ["Call first"],
        lockBoxType: ["Supra"],
      }),
    ).toEqual({ security: ["Smoke Detector(s)"] });
  });
});
