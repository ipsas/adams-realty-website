import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { BRAND_LEGAL_NAME } from "./brand";
import {
  CONTACT_DESCRIPTION,
  CONTACT_TITLE,
  HOME_DESCRIPTION,
  HOME_EYEBROW,
  HOME_TITLE,
} from "./brand-copy";
import { site } from "./site";

// The pages' data, auth and UI modules: stubbed so importing a page needs no database or env.
const Stub = () => null;
vi.mock("next/image", () => ({ default: Stub }));
vi.mock("next/link", () => ({ default: Stub }));
vi.mock("@/components/listings/listing-card", () => ({ ListingCard: Stub }));
vi.mock("@/components/listings/contact-form", () => ({ ContactForm: Stub }));
vi.mock("@/components/content/contact-methods", () => ({ ContactMethods: Stub }));
vi.mock("@/components/search/hero-search", () => ({ HeroSearch: Stub }));
vi.mock("@/components/seo/json-ld", () => ({ OrganizationJsonLd: Stub }));
vi.mock("@/components/ui/avatar", () => ({ Avatar: Stub }));
vi.mock("@/components/ui/button", () => ({ LinkButton: Stub }));
vi.mock("@/components/ui/photo", () => ({ Photo: Stub }));
vi.mock("@/components/ui/section", () => ({ Container: Stub, SectionHeading: Stub }));
vi.mock("@/lib/agents/queries", () => ({ getAgents: async () => [] }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/listings/cached", () => ({
  getCachedFeaturedListings: async () => [],
  getCachedMarketStats: async () => ({}),
  getCachedPopularAreas: async () => [],
}));
vi.mock("@/lib/listings/places-index", () => ({ NO_HOMES_FOR_SALE: "" }));
vi.mock("@/lib/listings/queries", () => ({ FEATURED_MIN: 4, getNewestListings: async () => [] }));

const HOME_PAGE = fileURLToPath(new URL("../app/(site)/page.tsx", import.meta.url));

describe("BR-B1 brand copy", () => {
  it("keeps the legal name in one place", () => {
    expect(BRAND_LEGAL_NAME).toBe("Adams Realty, Inc.");
    expect(site.legalName).toBe(BRAND_LEGAL_NAME);
  });

  it("matches the approved strings", () => {
    expect(HOME_TITLE).toBe("Adams Realty, Inc. | Royston, GA Real Estate Brokerage");
    expect(HOME_DESCRIPTION).toBe(
      "Adams Realty, Inc. is a Royston, GA real estate brokerage with homes, land, farms and lake property around Gainesville and Lake Lanier, from Georgia MLS.",
    );
    expect(HOME_EYEBROW).toBe("Adams Realty, Inc. · Royston, GA");
    expect(CONTACT_TITLE).toBe("Contact Adams Realty, Inc. | 69 Mill Street, Royston, GA");
    expect(CONTACT_DESCRIPTION).toBe(
      "Call Adams Realty, Inc. at (706) 246-0053 or send a message. Our office is at 69 Mill Street, Royston, GA 30662, with agents across Northeast Georgia.",
    );
  });

  it("has the approved lengths", () => {
    expect(HOME_TITLE).toHaveLength(54);
    expect(HOME_DESCRIPTION).toHaveLength(153);
    expect(HOME_EYEBROW).toHaveLength(32);
    expect(CONTACT_TITLE).toHaveLength(56);
    expect(CONTACT_DESCRIPTION).toHaveLength(150);
  });

  it("is the home page's title and description", async () => {
    const { metadata } = await import("@/app/(site)/page");
    expect(metadata.title).toEqual({
      absolute: "Adams Realty, Inc. | Royston, GA Real Estate Brokerage",
    });
    expect(metadata.description).toBe(
      "Adams Realty, Inc. is a Royston, GA real estate brokerage with homes, land, farms and lake property around Gainesville and Lake Lanier, from Georgia MLS.",
    );
  });

  it("is the contact page's title and description", async () => {
    const { metadata } = await import("@/app/(site)/contact/page");
    expect(metadata.title).toEqual({
      absolute: "Contact Adams Realty, Inc. | 69 Mill Street, Royston, GA",
    });
    expect(metadata.description).toBe(
      "Call Adams Realty, Inc. at (706) 246-0053 or send a message. Our office is at 69 Mill Street, Royston, GA 30662, with agents across Northeast Georgia.",
    );
  });

  it("is the home page hero's eyebrow", () => {
    const source = readFileSync(HOME_PAGE, "utf8");
    expect(source).toContain("{HOME_EYEBROW}");
    expect(source).not.toContain("Straight from {site.mls.name}");
  });
});
