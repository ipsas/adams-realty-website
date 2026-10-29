import { describe, expect, it } from "vitest";
import { guideForListingSlug } from "./missing-listing";
import { listingSlug } from "./slug";

const slug = (l: {
  addressLine1?: string;
  city: string;
  hideAddress?: boolean;
  postalCode?: string;
}) =>
  listingSlug({
    addressLine1: l.addressLine1 ?? "1204 Dogwood Ln",
    city: l.city,
    state: "GA",
    postalCode: l.postalCode ?? "30662",
    hideAddress: l.hideAddress,
    sourceSlug: "gamls",
    listingKey: `${l.city}-${l.addressLine1}`,
  });

describe("guideForListingSlug", () => {
  it("uses the row's city when the listing row exists", () => {
    expect(
      guideForListingSlug("anything", { city: "Royston", state: "GA", county: "Franklin" })?.slug,
    ).toBe("royston");
    expect(
      guideForListingSlug("anything", { city: "Royston", state: "GA", county: null })?.slug,
    ).toBe("royston");
  });

  it("has no guide for a row whose city has none, or in another county or state", () => {
    expect(guideForListingSlug("anything", { city: "Athens", state: "GA", county: "Clarke" })).toBe(
      undefined,
    );
    expect(
      guideForListingSlug("anything", { city: "Royston", state: "GA", county: "Chatham" }),
    ).toBe(undefined);
    expect(guideForListingSlug("anything", { city: "Royston", state: "SC", county: null })).toBe(
      undefined,
    );
  });

  it("doesn't fall back to the slug when the row's city has no guide", () => {
    const s = slug({ city: "Royston" });
    expect(guideForListingSlug(s, { city: "Athens", state: "GA", county: "Clarke" })).toBe(
      undefined,
    );
  });

  it("reads the town from the slug without a row", () => {
    expect(guideForListingSlug(slug({ city: "Royston" }))?.slug).toBe("royston");
    expect(guideForListingSlug(slug({ city: "Toccoa", hideAddress: true }))?.slug).toBe("toccoa");
    expect(guideForListingSlug(slug({ city: "Royston", postalCode: "30662-1234" }))?.slug).toBe(
      "royston",
    );
  });

  it("matches a multiword town, and a town a guide covers as a section", () => {
    expect(guideForListingSlug(slug({ city: "Flowery Branch" }))?.slug).toBe("flowery-branch");
    expect(guideForListingSlug(slug({ city: "Sugar Hill", hideAddress: true }))?.slug).toBe(
      "sugar-hill",
    );
    expect(guideForListingSlug(slug({ city: "Hoschton" }))?.slug).toBe("braselton");
  });

  it("only reads the segment before the state, never other words", () => {
    // The street names a guide town; the listing's town has none.
    expect(guideForListingSlug(slug({ addressLine1: "12 Royston Rd", city: "Athens" }))).toBe(
      undefined,
    );
  });

  it("has no guide for an unknown town or a garbage slug", () => {
    expect(guideForListingSlug(slug({ city: "Athens" }))).toBe(undefined);
    expect(guideForListingSlug("royston")).toBe(undefined);
    expect(guideForListingSlug("royston-ga")).toBe(undefined);
    expect(guideForListingSlug("")).toBe(undefined);
    expect(guideForListingSlug("1204-dogwood-ln-royston-sc-29662-a1b2c3d")).toBe(undefined);
    expect(guideForListingSlug("../../etc/passwd")).toBe(undefined);
  });
});
