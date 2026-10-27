import { describe, expect, it } from "vitest";
import { cardColumns, type CardRow } from "./card";
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

  it("uses the Office-resource name when the feed's is blank, after the feed's", () => {
    expect(
      listingOfficeLabel(
        { listOfficeName: " ", officeLookupName: " Re/Max Center ", listOfficeMlsId: "RMCR" },
        firm,
      ),
    ).toBe("Re/Max Center");
    expect(
      listingOfficeLabel(
        { listOfficeName: "Peachtree Partners", officeLookupName: "Re/Max Center" },
        firm,
      ),
    ).toBe("Peachtree Partners");
  });

  it("prefers the looked-up name to the firm's legal name", () => {
    expect(
      listingOfficeLabel(
        { officeLookupName: "Adams Realty Inc", listOfficeMlsId: "ADAM01", isCompanyListing: true },
        firm,
      ),
    ).toBe("Adams Realty Inc");
  });

  it("falls back to the MLS office ID when the lookup found nothing", () => {
    for (const officeLookupName of [null, " ", undefined]) {
      expect(listingOfficeLabel({ officeLookupName, listOfficeMlsId: "RMCR" }, firm)).toBe(
        "MLS Office ID RMCR",
      );
    }
  });

  it("labels a card row (cardColumns selects the looked-up name)", () => {
    expect(Object.keys(cardColumns)).toEqual(
      expect.arrayContaining(["listOfficeName", "officeLookupName", "listOfficeMlsId"]),
    );
    const card: Pick<
      CardRow,
      "listOfficeName" | "officeLookupName" | "listOfficeMlsId" | "isCompanyListing"
    > = {
      listOfficeName: null,
      officeLookupName: "Re/Max Center",
      listOfficeMlsId: "RMCR",
      isCompanyListing: false,
    };
    expect(listingOfficeLabel(card, firm)).toBe("Re/Max Center");
    expect(listingOfficeLabel({ ...card, officeLookupName: null }, firm)).toBe(
      "MLS Office ID RMCR",
    );
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
