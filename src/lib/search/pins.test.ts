import { describe, expect, it, vi } from "vitest";

// toPins is pure; the module's queries aren't run here.
vi.mock("@/db", () => ({ db: {} }));

const { toPins } = await import("./service");

const row = {
  id: "l1",
  slug: "1-main-st",
  lat: 34.3,
  lng: -83.1,
  price: 250_000,
  closePrice: null,
  status: "active",
  beds: 3,
  baths: 2,
  sqft: 1500,
  propertyType: "single_family",
  lotSqft: null,
  transactionType: "sale",
  addressLine1: "1 Main St",
  unitNumber: null,
  city: "Royston",
  hideAddress: false,
  photo: null,
  featured: false,
  office: "Adams Realty, Inc.",
  attributionPhone: null,
  attributionEmail: "andrea.adamsreatly@gmail.com",
  listAgentId: null,
  listAgentMlsId: "ANDEREGGAA",
  company: true,
  fromFeed: true,
};

describe("toPins", () => {
  it("gives the map popup the firm's fixed email for her listings, others' as sent", () => {
    const [mine, other] = toPins([
      row,
      { ...row, id: "l2", attributionEmail: "jane@brokerage.com", listAgentMlsId: "GA-777" },
    ]);
    expect(mine.attributionEmail).toBe("contracts.adamsrealty@gmail.com");
    expect(other.attributionEmail).toBe("jane@brokerage.com");
  });

  it("names another firm's office by its looked-up name, else its MLS office ID", () => {
    const other = { ...row, office: null, company: false, listOfficeMlsId: "RMCR" };
    const [named, unknown] = toPins([
      { ...other, officeLookupName: "Re/Max Center" },
      { ...other, id: "l2", officeLookupName: null },
    ]);
    expect(named.office).toBe("Re/Max Center");
    expect(unknown.office).toBe("MLS Office ID RMCR");
  });
});
