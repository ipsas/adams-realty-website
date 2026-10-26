import { describe, expect, it } from "vitest";
import {
  LISTING_SITEMAP_CHUNK_SIZE,
  LISTING_SITEMAP_CHUNKS,
  listingSitemapUrls,
} from "./sitemap-chunks";

describe("listingSitemapUrls", () => {
  const base = "https://example.com";
  const urls = (n: number) => Array.from({ length: n }, (_, id) => `${base}/homes/sitemap/${id}.xml`);

  it("lists no chunk for no listings", () => {
    expect(listingSitemapUrls(base, 0)).toEqual([]);
  });

  it("lists just the chunks that hold listings", () => {
    expect(LISTING_SITEMAP_CHUNK_SIZE).toBe(10_000);
    expect(listingSitemapUrls(base, 1)).toEqual(urls(1));
    expect(listingSitemapUrls(base, 10_000)).toEqual(urls(1));
    expect(listingSitemapUrls(base, 10_001)).toEqual(urls(2));
  });

  it("never lists more than the fixed chunks", () => {
    const capacity = LISTING_SITEMAP_CHUNKS * LISTING_SITEMAP_CHUNK_SIZE;
    expect(listingSitemapUrls(base, capacity)).toEqual(urls(LISTING_SITEMAP_CHUNKS));
    expect(listingSitemapUrls(base, capacity + 1)).toEqual(urls(LISTING_SITEMAP_CHUNKS));
  });
});
