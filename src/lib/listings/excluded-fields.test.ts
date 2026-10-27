import { describe, expect, it } from "vitest";
import {
  EXCLUDED_FIELD_KEYS,
  EXCLUDED_FIELDS,
  isExcludedField,
  isRestrictedValue,
  redactAccessCodes,
  withoutExcludedFields,
} from "./excluded-fields";
import { CODE_THEN_TEXT, NO_CODE, WITH_CODE } from "./access-code-cases";
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

  it("drops access values (lockbox, codes, showing instructions) from feature lists", () => {
    expect(
      withoutExcludedFields({
        security: ["Security System", "Alarm code 1234", "Smoke Detector(s)", "Fire Alarm"],
        community: ["Gated Community", "Gate code 4455"],
        laundry: ["Washer/Dryer Combo"],
        exterior: ["Lockbox on porch", "Porch"],
      }),
    ).toEqual({
      security: ["Security System", "Smoke Detector(s)", "Fire Alarm"],
      community: ["Gated Community"],
      laundry: ["Washer/Dryer Combo"],
      exterior: ["Porch"],
    });
  });
});

describe("isRestrictedValue", () => {
  it("matches access and showing phrases in any case, with or without digits", () => {
    for (const v of [
      "Alarm code 1234",
      "ALARM CODE: 9876",
      "lockbox",
      "Lock Box on side door",
      "LockBox - Supra",
      "Combo 1234",
      "combo: 55-12",
      "Combo lock on gate",
      "gate code 4455",
      "Access code #2020",
      "Door code is 1111",
      "Showing instructions: call listing agent",
      "See showing instruction",
      "Key under mat",
    ])
      expect(isRestrictedValue(v), v).toBe(true);
  });

  it("leaves normal preset values alone", () => {
    for (const v of [
      "Security System",
      "Gated Community",
      "Smoke Detector(s)",
      "Fire Alarm",
      "Carbon Monoxide Detector(s)",
      "Security Gate",
      "Keyless Entry",
      "Washer/Dryer Combo",
      "Showing Room",
      "Codes Compliant",
    ])
      expect(isRestrictedValue(v), v).toBe(false);
  });
});

describe("redactAccessCodes", () => {
  it("masks the digits after an access phrase and keeps the rest of the remarks", () => {
    expect(redactAccessCodes("Lovely ranch. Gate code 4455. Alarm code: 1234 on entry.")).toBe(
      "Lovely ranch. Gate code ****. Alarm code: **** on entry.",
    );
    expect(redactAccessCodes("Lockbox combo is 12-34 at the side door")).toBe(
      "Lockbox combo is **** at the side door",
    );
  });

  it("leaves remarks without an access code unchanged", () => {
    const text = "3 bedrooms, 2 baths, fire alarm, built 1998 on 2.5 acres in a gated community.";
    expect(redactAccessCodes(text)).toBe(text);
  });
});

describe("access code masking", () => {
  it.each(NO_CODE)("leaves %j unchanged", (text) => {
    expect(redactAccessCodes(text)).toBe(text);
    expect(redactAccessCodes(`Lovely home. ${text}. Call today.`)).toBe(
      `Lovely home. ${text}. Call today.`,
    );
  });

  it.each(WITH_CODE)("masks the whole code in %j", (text, code) => {
    const masked = redactAccessCodes(`Lovely home. ${text}. Call today.`);
    expect(masked).toContain("****");
    expect(masked).not.toContain(code);
    expect(masked.replace("Lovely home. ", "")).not.toMatch(/\d/);
    expect(masked).toMatch(/^Lovely home\. .*\*\*\*\*#?\. Call today\.$/);
  });

  it.each(CODE_THEN_TEXT)("masks only the code in %j", (text, masked) => {
    expect(redactAccessCodes(text)).toBe(masked);
  });

  it("keeps the remarks of 256 Adams Place as written", () => {
    const text = "Open floor plan with dining combo, 2-car garage and a fenced yard.";
    expect(redactAccessCodes(text)).toBe(text);
  });

  it("drops coded items from feature lists and keeps the rest", () => {
    expect(
      withoutExcludedFields({
        interior: ["Dining Combo", "Keypad Entry", "Keypad 1234"],
        garage: ["Garage code 5678", "Attached"],
        exterior: ["Lockbox: 4521", "Porch"],
      }),
    ).toEqual({
      interior: ["Dining Combo", "Keypad Entry"],
      garage: ["Attached"],
      exterior: ["Porch"],
    });
  });
});
