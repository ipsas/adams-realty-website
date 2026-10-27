import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { toEmailListing, type AlertListing } from "@/lib/alerts/present";
import { cardColumns, type CardRow } from "./card";
import { listingOfficeLabel } from "./office-label";
import { trafficOfficeLabel, type ListingViewRow } from "./views";

const firm = { legalName: "Adams Realty, Inc." };

describe("listingOfficeLabel", () => {
  it("prefers the feed's ListOfficeName for another firm's listing", () => {
    expect(
      listingOfficeLabel(
        {
          listOfficeName: " Peachtree Partners ",
          officeLookupName: "Re/Max Center",
          listOfficeMlsId: "PEACH1",
          isCompanyListing: false,
        },
        firm,
      ),
    ).toBe("Peachtree Partners");
  });

  it("names the firm for its own feed listing even when the feed sends an office name", () => {
    expect(
      listingOfficeLabel(
        {
          listOfficeName: "Adams Realty Royston",
          officeLookupName: "Adams Realty Inc",
          listOfficeMlsId: "ADAM01",
          isCompanyListing: true,
        },
        firm,
      ),
    ).toBe("Adams Realty, Inc.");
  });

  it("names the firm for a manual dashboard listing over its stored office name", () => {
    // Rows saved before the dashboard stored site.legalName carry "Adams Realty".
    expect(
      listingOfficeLabel(
        { listOfficeName: "Adams Realty", listOfficeMlsId: null, isCompanyListing: true },
        site,
      ),
    ).toBe("Adams Realty, Inc.");
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

  it("prefers the firm's legal name to the looked-up name for its own listing", () => {
    expect(
      listingOfficeLabel(
        { officeLookupName: "Adams Realty Inc", listOfficeMlsId: "ADAM01", isCompanyListing: true },
        firm,
      ),
    ).toBe("Adams Realty, Inc.");
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

describe("own office (ADAM01) shows the legal name on every surface", () => {
  const own = {
    listOfficeName: null,
    officeLookupName: "Adams Realty Inc",
    listOfficeMlsId: "ADAM01",
    isCompanyListing: true,
  };

  it("card", () => {
    const card: Pick<
      CardRow,
      "listOfficeName" | "officeLookupName" | "listOfficeMlsId" | "isCompanyListing"
    > = own;
    expect(listingOfficeLabel(card, firm)).toBe("Adams Realty, Inc.");
  });

  it("pin", () => {
    // The mapping in src/lib/search/service.ts.
    const r = {
      office: null,
      listOfficeMlsId: "ADAM01",
      officeLookupName: "Adams Realty Inc",
      company: true,
    };
    expect(
      listingOfficeLabel(
        {
          listOfficeName: r.office,
          listOfficeMlsId: r.listOfficeMlsId,
          officeLookupName: r.officeLookupName,
          isCompanyListing: r.company,
        },
        site,
      ),
    ).toBe("Adams Realty, Inc.");
  });

  it("email", () => {
    const l = { ...own, slug: "x", status: "active", listPrice: 1 } as unknown as AlertListing;
    expect(toEmailListing(l).attribution).toBe("Listed by Adams Realty, Inc.");
  });

  it("export", () => {
    const r: ListingViewRow = {
      ...own,
      listingId: "1",
      mlsNumber: "123",
      slug: "x",
      address: "1 Main St",
      city: "Royston",
      fromFeed: true,
      views: 1,
    };
    expect(trafficOfficeLabel(r)).toBe("Adams Realty, Inc.");
  });
});
