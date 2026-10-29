import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { captureConsole } from "@/test/console";
import {
  guideBySlug,
  guideSlugForMissingListing,
  listingPagePathSlug,
  MISSING_LISTING_GUIDE_HEADER,
} from "./missing-listing";
import { missingListingGuide } from "./missing-listing-db";

// The proxy's database work: the limiter (no client IP here, so unused) and the lookup.
vi.mock("@/lib/rate-limit-db", () => ({
  hitRateLimits: vi.fn(async () => ({ ok: true, retryAfter: 0, exceeded: null })),
}));
vi.mock("./missing-listing-db", () => ({ missingListingGuide: vi.fn() }));

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36";
const SLUG = "1204-dogwood-ln-royston-ga-30662-a1b2c3d";

beforeEach(() => {
  vi.mocked(missingListingGuide).mockReset();
});

describe("listingPagePathSlug", () => {
  it("is the decoded slug of /homes/<one segment>, and null for anything else", () => {
    expect(listingPagePathSlug("/homes/x")).toBe("x");
    expect(listingPagePathSlug("/homes/a%20b")).toBe("a b");
    expect(listingPagePathSlug("/homes")).toBeNull();
    expect(listingPagePathSlug("/homes/")).toBeNull();
    expect(listingPagePathSlug("/homes/x/y")).toBeNull();
    expect(listingPagePathSlug("/homes/sitemap/1.xml")).toBeNull();
    expect(listingPagePathSlug("/homes/a.xml")).toBeNull();
    expect(listingPagePathSlug("/homes/%E0%A4%A")).toBeNull();
    expect(listingPagePathSlug("/areas/royston")).toBeNull();
  });
});

describe("guideSlugForMissingListing", () => {
  it("reads the town from the slug, shortest ending first, exact guide slugs only", () => {
    expect(guideSlugForMissingListing(SLUG)).toBe("royston");
    expect(guideSlugForMissingListing("5-main-st-flowery-branch-ga-30542-a1b2c3d")).toBe(
      "flowery-branch",
    );
    expect(guideSlugForMissingListing("9-peachtree-ind-blvd-sugar-hill-ga-30518-a1b2c3d")).toBe(
      "sugar-hill",
    );
    expect(guideSlugForMissingListing("12-lake-dr-hartwell-ga-30643-a1b2c3d")).toBe("hartwell");
    expect(guideSlugForMissingListing("7-lake-lanier-dr-cumming-ga-30041-a1b2c3d")).toBeUndefined();
    expect(
      guideSlugForMissingListing("1006-heathmoor-court-norcross-ga-30093-1yfukwj"),
    ).toBeUndefined();
    expect(guideSlugForMissingListing("royston-ga-30662-a1b2c3d")).toBe("royston");
    expect(guideSlugForMissingListing("royston-ga-30662-1234-a1b2c3d")).toBe("royston");
    expect(guideSlugForMissingListing("12-main-st-royston-sc-29659-a1b2c3d")).toBeUndefined();
    expect(guideSlugForMissingListing("not-a-listing")).toBeUndefined();
  });

  it("uses the row's city when there is one, in Georgia only", () => {
    expect(guideSlugForMissingListing("x", { city: "Royston", state: "GA" })).toBe("royston");
    expect(guideSlugForMissingListing("x", { city: "Royston", state: " georgia " })).toBe(
      "royston",
    );
    expect(guideSlugForMissingListing("x", { city: "Lake Hartwell", state: "GA" })).toBe(
      "lake-hartwell",
    );
    expect(guideSlugForMissingListing("x", { city: "Royston", state: "SC" })).toBeUndefined();
    expect(guideSlugForMissingListing(SLUG, { city: "Toccoa", state: "GA" })).toBe("toccoa");
    expect(guideSlugForMissingListing(SLUG, { city: "Athens", state: "GA" })).toBeUndefined();
  });
});

describe("guideBySlug", () => {
  it("finds a guide by its exact slug only", () => {
    expect(guideBySlug("royston")?.name).toBe("Royston");
    expect(guideBySlug("lake-hartwell")?.name).toBe("Lake Hartwell");
    for (const s of ["Royston", "royston ", "lake hartwell", "hoschton", "", null, undefined]) {
      expect(guideBySlug(s), String(s)).toBeUndefined();
    }
  });
});

describe("the proxy on a listing page", () => {
  const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(`http://localhost${path}`, {
      method: init.method ?? "GET",
      headers: { "user-agent": CHROME, ...init.headers },
    });
  const rewrite = (res: Response) => res.headers.get("x-middleware-rewrite");
  const forwarded = (res: Response) =>
    res.headers.get(`x-middleware-request-${MISSING_LISTING_GUIDE_HEADER}`);

  it("rewrites a missing listing to an unmatched URL, its guide in a request header", async () => {
    vi.mocked(missingListingGuide).mockResolvedValue("royston");
    const res = await proxy(req(`/homes/${SLUG}`));
    expect(missingListingGuide).toHaveBeenCalledWith(expect.anything(), SLUG);
    expect(rewrite(res)).toBe(`http://localhost/homes/${SLUG}/removed`);
    expect(forwarded(res)).toBe("royston");
  });

  it("drops a client-sent guide header when the town has no guide", async () => {
    vi.mocked(missingListingGuide).mockResolvedValue(undefined);
    const res = await proxy(
      req(`/homes/${SLUG}`, { headers: { [MISSING_LISTING_GUIDE_HEADER]: "royston" } }),
    );
    expect(rewrite(res)).toBe(`http://localhost/homes/${SLUG}/removed`);
    expect(forwarded(res)).toBeNull();
    expect(res.headers.get("x-middleware-override-headers")).not.toContain(
      MISSING_LISTING_GUIDE_HEADER,
    );
  });

  it("passes a shown listing through", async () => {
    vi.mocked(missingListingGuide).mockResolvedValue(null);
    const res = await proxy(req(`/homes/${SLUG}`));
    expect(missingListingGuide).toHaveBeenCalledOnce();
    expect(rewrite(res)).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("doesn't look up posts, prefetches, search or sitemaps", async () => {
    for (const r of [
      req(`/homes/${SLUG}`, { method: "POST", headers: { "next-action": "7f00aa" } }),
      req(`/homes/${SLUG}`, { headers: { "next-router-prefetch": "1" } }),
      req("/homes?q=royston"),
      req("/homes/sitemap/0.xml"),
    ]) {
      expect(rewrite(await proxy(r))).toBeNull();
    }
    expect(missingListingGuide).not.toHaveBeenCalled();
  });

  it("passes the request through when the database fails", async () => {
    const console = captureConsole();
    vi.mocked(missingListingGuide).mockRejectedValue(new Error("connection refused"));
    const res = await proxy(req(`/homes/${SLUG}`));
    const output = console.output();
    console.restore();
    expect(rewrite(res)).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(output).toEqual([expect.stringContaining("[proxy] missing-listing lookup failed")]);
  });
});
