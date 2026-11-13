import { describe, expect, it } from "vitest";
import { firmListingPhones } from "./firm-phones";

describe("firmListingPhones", () => {
  it("puts the office phone first and the broker's cell second on the firm's listings", () => {
    expect(firmListingPhones({ isCompanyListing: true, fromFeed: true }, "706-246-0053")).toEqual({
      office: { text: "(706) 246-0053", href: "tel:+17062460053" },
      secondary: [{ text: "Andrea's cell (850) 572-3287", href: "tel:+18505723287" }],
    });
  });

  it("treats a manual listing (fromFeed: false) as the firm's own", () => {
    expect(firmListingPhones({ isCompanyListing: false, fromFeed: false })?.office.href).toBe(
      "tel:+17062460053",
    );
  });

  it("keeps a third attribution phone in the smaller line, never one of the firm's twice", () => {
    const own = { isCompanyListing: true };
    expect(firmListingPhones(own, "706-555-0100")?.secondary.map((p) => p.text)).toEqual([
      "Andrea's cell (850) 572-3287",
      "706-555-0100",
    ]);
    expect(firmListingPhones(own, "1-850-572-3287")?.secondary).toHaveLength(1);
  });

  it("shows no Adams number on another brokerage's listing", () => {
    const other = { isCompanyListing: false, fromFeed: true };
    expect(firmListingPhones(other, "404-555-0166")).toBeNull();
    // A card cached without fromFeed stays as it was.
    expect(firmListingPhones({ isCompanyListing: false })).toBeNull();
  });
});
