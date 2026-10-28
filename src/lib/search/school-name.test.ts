import { describe, expect, it } from "vitest";
import { formatSchoolName, isPlaceholderSchool, schoolKey, SCHOOL_LEVELS } from "./school-name";

describe("schoolKey", () => {
  it("trims, collapses whitespace and lower-cases", () => {
    expect(schoolKey("  NORTH   Hart ")).toBe("north hart");
    expect(schoolKey("North Hart")).toBe(schoolKey("NORTH HART"));
    expect(SCHOOL_LEVELS).toEqual(["elementary", "middle", "high"]);
  });
});

describe("isPlaceholderSchool", () => {
  it("knows the feed's no-school values", () => {
    for (const s of ["Other", "NONE", "n/a", "NA", "Unknown", " See  Remarks ", "", "   "]) {
      expect(isPlaceholderSchool(s)).toBe(true);
    }
    expect(isPlaceholderSchool("Hart")).toBe(false);
    expect(isPlaceholderSchool("Other Side")).toBe(false);
  });
});

describe("formatSchoolName", () => {
  it("title-cases all-upper and all-lower names", () => {
    expect(formatSchoolName("NORTH HART")).toBe("North Hart");
    expect(formatSchoolName("  north   hart ")).toBe("North Hart");
    expect(formatSchoolName("HART COUNTY HIGH SCHOOL")).toBe("Hart County High School");
  });

  it("title-cases after '-' and '/'", () => {
    expect(formatSchoolName("LAVONIA-ROYSTON")).toBe("Lavonia-Royston");
    expect(formatSchoolName("north/south")).toBe("North/South");
  });

  it("keeps acronyms upper", () => {
    expect(formatSchoolName("HART ES")).toBe("Hart ES");
    expect(formatSchoolName("hart ms")).toBe("Hart MS");
    expect(formatSchoolName("FRANKLIN COUNTY HS")).toBe("Franklin County HS");
    expect(formatSchoolName("STEM ACADEMY")).toBe("STEM Academy");
    expect(formatSchoolName("STEAM ACADEMY")).toBe("STEAM Academy");
    expect(formatSchoolName("IB WORLD SCHOOL")).toBe("IB World School");
    expect(formatSchoolName("KIPP ATLANTA")).toBe("KIPP Atlanta");
    expect(formatSchoolName("YMCA ACADEMY")).toBe("YMCA Academy");
    expect(formatSchoolName("SMITH II")).toBe("Smith II");
    expect(formatSchoolName("SMITH III")).toBe("Smith III");
    expect(formatSchoolName("SMITH IV")).toBe("Smith IV");
    expect(formatSchoolName("ROYSTON K-8")).toBe("Royston K-8");
    expect(formatSchoolName("royston k-8")).toBe("Royston K-8");
  });

  it("spells Mc, O' and the De/La names", () => {
    expect(formatSchoolName("MCEVER")).toBe("McEver");
    expect(formatSchoolName("mcintosh high")).toBe("McIntosh High");
    expect(formatSchoolName("O'NEAL ELEMENTARY")).toBe("O'Neal Elementary");
    expect(formatSchoolName("DEKALB")).toBe("DeKalb");
    expect(formatSchoolName("DESOTO")).toBe("DeSoto");
    expect(formatSchoolName("LAGRANGE HIGH")).toBe("LaGrange High");
    // Not Mac: Macon stays Macon.
    expect(formatSchoolName("MACON")).toBe("Macon");
    expect(formatSchoolName("MACK")).toBe("Mack");
  });

  it("keeps mixed-case names as spelled, single-spaced", () => {
    expect(formatSchoolName("DeKalb")).toBe("DeKalb");
    expect(formatSchoolName("McIntosh  High")).toBe("McIntosh High");
    expect(formatSchoolName(" Hart  County HS ")).toBe("Hart County HS");
  });
});
