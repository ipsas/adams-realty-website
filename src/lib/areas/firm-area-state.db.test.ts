import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findArea } from "@/config/areas";
import { db } from "@/db";
import { inquiries, listings } from "@/db/schema";
import { formTokenSecret, issueFormToken } from "@/lib/form-token";
import { submitInquiry } from "@/lib/leads/submit";
import { listingRobots } from "@/lib/listings/indexing";
import { getFeaturedListings, getListingBySlug } from "@/lib/listings/queries";
import { countSitemapListings, getListingSitemapChunk } from "@/lib/listings/sitemap-query";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { offersTours } from "./firm-area";
import { getAreaListings, getAreaStats } from "./queries";

// The firm's area and the area guides are Georgia's: county names repeat
// across states (Jackson County, NC; Madison County, AL), and a Gainesville,
// FL home with no county is not in the Gainesville guide.

const listDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

const GA_FIRM = [
  { key: 1, city: "Jefferson", county: "Jackson", postalCode: "30549" },
  { key: 2, city: "Danielsville", county: "Madison", postalCode: "30633" },
  { key: 3, city: "Gainesville", county: "Hall", postalCode: "30501" },
  { key: 4, city: "Hartwell", county: "Hart", postalCode: "30643" },
  { key: 5, city: "Royston", county: "Franklin", postalCode: "30662" },
  { key: 6, city: "Toccoa", county: "Stephens", postalCode: "30577" },
  // Stored with state "Georgia" (below).
  { key: 7, city: "Commerce", county: "Jackson", postalCode: "30529" },
];
const OUT_OF_STATE = [
  { key: 11, city: "Sylva", state: "NC", county: "Jackson", postalCode: "28779" },
  { key: 12, city: "Scottsboro", state: "AL", county: "Jackson", postalCode: "35768" },
  { key: 13, city: "Huntsville", state: "AL", county: "Madison", postalCode: "35801" },
  { key: 14, city: "Winchester", state: "TN", county: "Franklin", postalCode: "37398" },
  { key: 15, city: "Grand Island", state: "NE", county: "Hall", postalCode: "68801" },
  { key: 16, city: "Munfordville", state: "KY", county: "Hart", postalCode: "42765" },
  { key: 17, city: "Duncan", state: "OK", county: "Stephens", postalCode: "73533" },
  { key: 18, city: "Gainesville", state: "FL", county: null, postalCode: "32601" },
  { key: 19, city: "Hartwell", state: "SC", county: null, postalCode: "29621" },
];
const GA_NO_COUNTY = { key: 21, city: "Gainesville", county: null, postalCode: "30501" };

const ids = new Map<number, string>();
const slugs = new Map<number, string>();
let companyId: string;

beforeAll(async () => {
  await resetDb();
  await db.execute(sql`truncate table inquiries, rate_limits, users cascade`);
  const mls = await createSource();
  const feed = [...GA_FIRM, ...OUT_OF_STATE, GA_NO_COUNTY];
  const feedIds = await insertListings(
    mls,
    feed.map(({ key, ...where }) => listing(key, { neighborhood: null, listDate, ...where })),
  );
  feed.forEach((f, i) => ids.set(f.key, feedIds[i]));
  await db.update(listings).set({ state: "Georgia" }).where(eq(listings.id, ids.get(7)!));
  // Adams Realty's own listing (manual source), out of state.
  const adams = await createSource({ slug: "adams", kind: "manual", config: {} });
  [companyId] = await insertListings(adams, [
    listing(100, { city: "Sylva", state: "NC", county: "Jackson", postalCode: "28779", listDate }),
  ]);
  for (const r of await db.select({ id: listings.id, slug: listings.slug }).from(listings)) {
    const key = [...ids].find(([, id]) => id === r.id)?.[0];
    if (key !== undefined) slugs.set(key, r.slug);
  }
});
afterAll(closeDb);

const keysOf = (rowIds: string[]) =>
  [...ids].filter(([, id]) => rowIds.includes(id)).map(([key]) => key);

const firmKeys = GA_FIRM.map((l) => l.key);
const outKeys = OUT_OF_STATE.map((l) => l.key);

describe("Handpicked by our agents", () => {
  it("holds Georgia's firm-area homes only", async () => {
    const featured = (await getFeaturedListings(50)).map((l) => l.id);
    expect(keysOf(featured).sort((a, b) => a - b)).toEqual(firmKeys);
    expect(featured).toContain(companyId);
  });
});

describe("the listing sitemap", () => {
  it("holds Georgia's firm-area homes and the firm's own", async () => {
    const chunk = (await getListingSitemapChunk(0, 1000)).map((r) => r.slug);
    const want = firmKeys.map((k) => slugs.get(k)!);
    expect(chunk).toEqual(expect.arrayContaining(want));
    for (const k of [...outKeys, GA_NO_COUNTY.key]) expect(chunk).not.toContain(slugs.get(k));
    expect(chunk).toHaveLength(want.length + 1);
    expect(await countSitemapListings()).toBe(want.length + 1);
  });
});

describe("a listing page", () => {
  it("offers tours and is indexable in Georgia's firm area only", async () => {
    for (const key of [...firmKeys, ...outKeys]) {
      const detail = await getListingBySlug(slugs.get(key)!);
      expect(detail, String(key)).not.toBeNull();
      const l = detail!.listing;
      const inArea = firmKeys.includes(key);
      expect(offersTours(l), `${l.city}, ${l.state}`).toBe(inArea);
      expect(listingRobots(l, "area"), `${l.city}, ${l.state}`).toEqual(
        inArea ? undefined : { index: false, follow: true },
      );
    }
  });

  it("still offers tours on the firm's own listing out of state", async () => {
    const [{ slug }] = await db
      .select({ slug: listings.slug })
      .from(listings)
      .where(eq(listings.id, companyId));
    const detail = await getListingBySlug(slug);
    expect(offersTours(detail!.listing)).toBe(true);
  });
});

describe("a tour request", () => {
  let ip = 0;
  const tour = async (key: number) => {
    const res = await submitInquiry(
      {
        type: "tour",
        source: "listing",
        listingId: ids.get(key)!,
        name: "Jordan Buyer",
        email: `jordan${++ip}@example.com`,
        tourDate: "2026-12-01",
        tourTime: "10:00",
        tourType: "in_person",
        website: "",
        formToken: issueFormToken(formTokenSecret(), Date.now() - 12_000),
      },
      {
        ip: `198.51.100.${ip}`,
        userId: null,
        referer: "https://adams.example/homes/x",
        userAgent: "Mozilla/5.0",
      },
      {
        db,
        send: async () => ({ ok: true as const }),
        siteUrl: "https://adams.example",
        inbox: "office@adams.example",
        production: true,
      },
    );
    expect(res.ok).toBe(true);
    return (await db.select().from(inquiries).where(eq(inquiries.id, res.id!)))[0];
  };

  it("is saved as a question, with no tour, on a same-name county out of state", async () => {
    for (const key of [11, 13]) {
      const lead = await tour(key);
      expect(lead.type, String(key)).toBe("question");
      expect(lead.tourAt).toBeNull();
      expect(lead.tourType).toBeNull();
    }
  });

  it("stays a tour in Jackson County, Georgia", async () => {
    const lead = await tour(1);
    expect(lead.type).toBe("tour");
    expect(lead.tourAt).not.toBeNull();
    expect(lead.tourType).toBe("in_person");
  });
});

describe("area guides", () => {
  const guide = async (slug: string) =>
    keysOf((await getAreaListings(findArea(slug)!, 50)).map((l) => l.id)).sort((a, b) => a - b);

  it("leave out Gainesville, FL and Hartwell, SC, and keep a county-less Gainesville, GA", async () => {
    expect(await guide("gainesville")).toEqual([3, GA_NO_COUNTY.key]);
    expect(await guide("hartwell")).toEqual([4]);
  });

  it("count the same homes in their stats", async () => {
    const stats = await getAreaStats([findArea("gainesville")!, findArea("hartwell")!]);
    expect(stats.get("gainesville")?.forSale).toBe(2);
    expect(stats.get("hartwell")?.forSale).toBe(1);
  });
});
