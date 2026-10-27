import { describe, expect, it } from "vitest";
import { listingOfficeLabel } from "./office-label";

const firm = { legalName: "Adams Realty, Inc." };

describe("listingOfficeLabel", () => {
  it("prefers the feed's ListOfficeName", () => {
    expect(
      listingOfficeLabel(
        {
          listOfficeName: " Peachtree Partners ",
          listOfficeMlsId: "ADAM99",
          isCompanyListing: true,
        },
        firm,
      ),
    ).toBe("Peachtree Partners");
  });

  it("ignores an empty or whitespace feed name", () => {
    for (const listOfficeName of [null, "", "   ", undefined]) {
      expect(listingOfficeLabel({ listOfficeName, listOfficeMlsId: "ADAM99" }, firm)).toBe(
        "MLS Office ID ADAM99",
      );
    }
  });

  it("names the firm for its own listing with no office name", () => {
    expect(
      listingOfficeLabel(
        { listOfficeName: " ", listOfficeMlsId: "ADAM01", isCompanyListing: true },
        firm,
      ),
    ).toBe("Adams Realty, Inc.");
  });

  it("falls back to the MLS office ID, and to null only with no office at all", () => {
    expect(listingOfficeLabel({ listOfficeName: null, listOfficeMlsId: "ADAM99" }, firm)).toBe(
      "MLS Office ID ADAM99",
    );
    expect(listingOfficeLabel({ listOfficeName: null, listOfficeMlsId: "  " }, firm)).toBeNull();
    expect(listingOfficeLabel({}, firm)).toBeNull();
  });

  it("never says Not provided", () => {
    const cases = [
      { listOfficeName: null, listOfficeMlsId: "X1" },
      { listOfficeName: "", listOfficeMlsId: "X2" },
      { isCompanyListing: true },
    ];
    for (const c of cases) expect(listingOfficeLabel(c, firm)).not.toMatch(/not provided/i);
  });
});
