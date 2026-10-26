import { describe, expect, it } from "vitest";
import { agentEmailOverrides } from "@/config/agent-email-overrides";
import { listingContact } from "./attribution-contact";

const OFFICE_PHONE = "706-246-0053";
const OFFICE_EMAIL = "contracts.adamsrealty@gmail.com";

describe("listingContact", () => {
  it("falls back to the office contact on the firm's own listing with neither field", () => {
    expect(
      listingContact({ attributionPhone: null, attributionEmail: null, isCompanyListing: true }),
    ).toEqual({ phone: OFFICE_PHONE, email: OFFICE_EMAIL });
  });

  it("fills each field on its own: the office phone with the listing's own email", () => {
    expect(
      listingContact({
        attributionPhone: " ",
        attributionEmail: "avery.adamsrealty@gmail.com",
        isCompanyListing: true,
      }),
    ).toEqual({ phone: OFFICE_PHONE, email: "avery.adamsrealty@gmail.com" });
  });

  it("formats a raw 10-digit phone, and is idempotent", () => {
    const contact = listingContact({ attributionPhone: "8505723287", attributionEmail: null });
    expect(contact.phone).toBe("850-572-3287");
    expect(listingContact({ attributionPhone: contact.phone, attributionEmail: null }).phone).toBe(
      "850-572-3287",
    );
    const office = listingContact({
      attributionPhone: null,
      attributionEmail: null,
      isCompanyListing: true,
    });
    expect(
      listingContact({
        attributionPhone: office.phone,
        attributionEmail: office.email,
        isCompanyListing: true,
      }),
    ).toEqual(office);
  });

  it("never fills in another firm's listing", () => {
    expect(
      listingContact({ attributionPhone: null, attributionEmail: null, isCompanyListing: false }),
    ).toEqual({ phone: null, email: null });
    expect(listingContact({ attributionPhone: null, attributionEmail: null })).toEqual({
      phone: null,
      email: null,
    });
  });

  it("still uses Andrea's email override over the feed's email", () => {
    const [andrea] = agentEmailOverrides;
    expect(
      listingContact({
        attributionPhone: null,
        attributionEmail: "andrea.adamsreatly@gmail.com",
        isCompanyListing: true,
        listAgentId: null,
        listAgentMlsId: andrea.mlsAgentId,
      }).email,
    ).toBe(andrea.email);
    expect(
      listingContact({
        attributionPhone: null,
        attributionEmail: "andrea.adamsreatly@gmail.com",
        listAgentId: andrea.agentId,
      }).email,
    ).toBe(andrea.email);
  });
});
