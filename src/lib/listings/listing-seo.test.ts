import { describe, expect, it } from "vitest";
import { formatStreet } from "@/lib/format";
import {
  LISTING_TITLE_MAX,
  listingBreadcrumbJsonLd,
  listingBreadcrumbs,
  listingDescription,
  listingTitle,
  type ListingBreadcrumbInput,
  type ListingSeoInput,
} from "./listing-seo";

const home: ListingSeoInput = {
  addressLine1: "12 Oak St",
  unitNumber: null,
  hideAddress: false,
  city: "Royston",
  state: "GA",
  postalCode: "30662",
  listPrice: 250000,
  bedrooms: 3,
  bathrooms: 2.5,
  livingAreaSqft: 1850,
  propertyType: "single_family",
  description: null,
};

const base = "https://adamsrealtyga.com";

describe("listingTitle", () => {
  it("is street, city, state ZIP – price | brand when it fits", () => {
    expect(listingTitle(home)).toBe("12 Oak St, Royston, GA 30662 – $250,000 | Adams Realty");
  });

  it("uses an en dash with spaces around it", () => {
    expect(listingTitle(home)).toContain(" – ");
    expect(listingTitle(home)).not.toContain(" - ");
  });

  it("writes Georgia as GA", () => {
    expect(listingTitle({ ...home, state: "Georgia" })).toBe(listingTitle(home));
  });

  it("drops the brand first when too long", () => {
    const t = listingTitle({
      ...home,
      addressLine1: "1161 Rose Terrace Circle",
      city: "Loganville",
      postalCode: "30052",
      listPrice: 350000,
    });
    expect(t).toBe("1161 Rose Terrace Circle, Loganville, GA 30052 – $350,000");
    expect(t.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
  });

  it("then drops the ZIP", () => {
    const t = listingTitle({
      ...home,
      addressLine1: "4520 Lake Hartwell Shores Parkway",
      city: "Hartwell",
      postalCode: "30643",
      listPrice: 1250000,
    });
    expect(t).toBe("4520 Lake Hartwell Shores Parkway, Hartwell, GA – $1,250,000");
    expect(t.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
  });

  it("keeps a title still too long whole rather than cutting words", () => {
    const street = "10450 Old Federal Road Northeast Extension Spur";
    const t = listingTitle({ ...home, addressLine1: street, city: "Flowery Branch" });
    expect(t).toBe(`${street}, Flowery Branch, GA – $250,000`);
    expect(t.length).toBeGreaterThan(LISTING_TITLE_MAX);
  });

  it("omits a missing ZIP", () => {
    expect(listingTitle({ ...home, postalCode: "" })).toBe(
      "12 Oak St, Royston, GA – $250,000 | Adams Realty",
    );
    expect(listingTitle({ ...home, postalCode: null })).toBe(
      "12 Oak St, Royston, GA – $250,000 | Adams Realty",
    );
  });

  it("uses the heading's text for a hidden address", () => {
    const t = listingTitle({ ...home, hideAddress: true });
    expect(t).toBe("Address withheld by seller, Royston, GA 30662 – $250,000");
    expect(t).not.toContain("12 Oak St");
  });
});

describe("listingDescription", () => {
  it("keeps remarks of 70 characters or more", () => {
    const remarks = "Charming brick ranch on a quiet street with a big fenced yard and a new roof.";
    expect(remarks.length).toBeGreaterThanOrEqual(70);
    expect(listingDescription({ ...home, description: `  ${remarks}  ` })).toBe(remarks);
  });

  it("builds one from the facts when remarks are short", () => {
    expect(listingDescription({ ...home, description: "Great home!" })).toBe(
      "3 bed, 2.5 bath single-family home in Royston, GA – 1,850 sq ft, listed at $250,000.",
    );
  });

  it("builds one when there are no remarks", () => {
    expect(listingDescription({ ...home, propertyType: "condo", bathrooms: 2 })).toBe(
      "3 bed, 2 bath condo in Royston, GA – 1,850 sq ft, listed at $250,000.",
    );
  });

  it("counts remarks after redacting access codes", () => {
    const d = listingDescription({ ...home, description: "Lockbox code 1234. Call first." });
    expect(d).not.toContain("1234");
  });

  it("drops only the missing facts and capitalises the start", () => {
    expect(listingDescription({ ...home, bedrooms: null })).toBe(
      "2.5 bath single-family home in Royston, GA – 1,850 sq ft, listed at $250,000.",
    );
    expect(listingDescription({ ...home, bathrooms: null })).toBe(
      "3 bed, single-family home in Royston, GA – 1,850 sq ft, listed at $250,000.",
    );
    expect(listingDescription({ ...home, livingAreaSqft: null })).toBe(
      "3 bed, 2.5 bath single-family home in Royston, GA, listed at $250,000.",
    );
    expect(
      listingDescription({
        ...home,
        propertyType: "land",
        bedrooms: null,
        bathrooms: null,
        livingAreaSqft: null,
      }),
    ).toBe("Land in Royston, GA, listed at $250,000.");
  });
});

describe("listingBreadcrumbs and listingBreadcrumbJsonLd", () => {
  const crumbHome: ListingBreadcrumbInput = {
    ...home,
    slug: "12-oak-st-royston-ga-30662",
    county: "Franklin",
    neighborhood: "Oak Hills",
  };

  /**
   * The JSON-LD is the visible crumbs that have links, with absolute URLs, then the listing
   * itself; no crumb links to (and no item is) a noindex /homes search.
   */
  function expectJsonLdMatchesVisible(l: ListingBreadcrumbInput, baseUrl = base) {
    const visible = listingBreadcrumbs(l);
    const linked = visible.filter((c) => c.href);
    const json = listingBreadcrumbJsonLd(l, baseUrl);
    expect(json["@context"]).toBe("https://schema.org");
    expect(json["@type"]).toBe("BreadcrumbList");
    expect(json.itemListElement).toEqual([
      ...linked.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.name,
        item: `${base}${c.href}`,
      })),
      {
        "@type": "ListItem",
        position: linked.length + 1,
        name: formatStreet(l),
        item: `${base}/homes/${l.slug}`,
      },
    ]);
    for (const c of visible) expect(c.href ?? "").not.toContain("/homes?q=");
    for (const item of json.itemListElement) expect(item.item).not.toContain("/homes?q=");
    return visible;
  }

  it("is Homes, the town and the neighborhood in market", () => {
    const visible = expectJsonLdMatchesVisible(crumbHome);
    expect(visible).toEqual([
      { name: "Homes", href: "/homes" },
      { name: "Royston", href: "/areas/royston" },
      { name: "Oak Hills" },
    ]);
  });

  it("links a guide town to its area guide, in the JSON-LD too", () => {
    const visible = expectJsonLdMatchesVisible({ ...crumbHome, neighborhood: null });
    expect(visible).toEqual([
      { name: "Homes", href: "/homes" },
      { name: "Royston", href: "/areas/royston" },
    ]);
    expect(listingBreadcrumbJsonLd({ ...crumbHome, neighborhood: null }, base).itemListElement)
      .toEqual([
        { "@type": "ListItem", position: 1, name: "Homes", item: `${base}/homes` },
        { "@type": "ListItem", position: 2, name: "Royston", item: `${base}/areas/royston` },
        {
          "@type": "ListItem",
          position: 3,
          name: "12 Oak St",
          item: `${base}/homes/${crumbHome.slug}`,
        },
      ]);
  });

  it("shows a town without a guide as text and leaves it out of the JSON-LD", () => {
    const l = { ...crumbHome, city: "Bowersville", county: "Hart" };
    const visible = expectJsonLdMatchesVisible(l);
    expect(visible).toEqual([
      { name: "Homes", href: "/homes" },
      { name: "Bowersville" },
      { name: "Oak Hills" },
    ]);
    expect(listingBreadcrumbJsonLd(l, base).itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Homes", item: `${base}/homes` },
      { "@type": "ListItem", position: 2, name: "12 Oak St", item: `${base}/homes/${l.slug}` },
    ]);
  });

  it("links a guide neighborhood under a town without a guide", () => {
    const l = { ...crumbHome, city: "Bowersville", county: "Hart", neighborhood: "Hartwell" };
    const visible = expectJsonLdMatchesVisible(l);
    expect(visible).toEqual([
      { name: "Homes", href: "/homes" },
      { name: "Bowersville" },
      { name: "Hartwell", href: "/areas/hartwell" },
    ]);
    expect(listingBreadcrumbJsonLd(l, base).itemListElement.map((c) => c.position)).toEqual([
      1, 2, 3,
    ]);
  });

  it("omits the neighborhood level when there is none", () => {
    const visible = expectJsonLdMatchesVisible({ ...crumbHome, neighborhood: null });
    expect(visible.map((c) => c.name)).toEqual(["Homes", "Royston"]);
  });

  it("omits a neighborhood that is the town", () => {
    const visible = expectJsonLdMatchesVisible({ ...crumbHome, neighborhood: "Royston" });
    expect(visible.map((c) => c.name)).toEqual(["Homes", "Royston"]);
  });

  it("omits a None-like neighborhood", () => {
    const visible = expectJsonLdMatchesVisible({ ...crumbHome, neighborhood: "None" });
    expect(visible.map((c) => c.name)).toEqual(["Homes", "Royston"]);
  });

  it("has only Homes outside Georgia", () => {
    const visible = expectJsonLdMatchesVisible({ ...crumbHome, state: "FL" });
    expect(visible).toEqual([{ name: "Homes", href: "/homes" }]);
  });

  it("strips trailing slashes from the base URL", () => {
    expectJsonLdMatchesVisible(crumbHome, `${base}//`);
  });

  it("names a hidden address as the heading does", () => {
    const json = listingBreadcrumbJsonLd({ ...crumbHome, hideAddress: true }, base);
    expect(json.itemListElement.at(-1)?.name).toBe("Address withheld by seller");
  });
});
