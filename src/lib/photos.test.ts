import defaultLoader from "next/dist/shared/lib/image-loader";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import {
  ALL_WIDTHS,
  PHONE_MAX_WIDTH,
  PHOTO_QUALITY,
  PHOTO_WIDTHS,
  THUMB_WIDTHS,
} from "@/config/images";
import { allowedWidth, photoRoute, photoSources, photoUrl, widthsFor } from "./photos";

const MLS = "https://media.mls.example/photos/12345/1.jpg?version=3&show=720";
const UNSPLASH = "https://images.unsplash.com/photo-1?auto=format&fit=crop&w=1600&q=80";

/** "url 480w, url 640w" → [[url, 480], [url, 640]] */
const candidates = (srcSet: string | undefined) =>
  (srcSet ?? "").split(", ").map((c) => {
    const [url, w] = c.split(" ");
    return [url, Number(w.replace("w", ""))] as const;
  });

describe("photoRoute", () => {
  it("resizes MLS and pasted photos through the optimizer, whatever the host", () => {
    expect(photoRoute(MLS)).toBe("optimize");
    expect(photoRoute("http://photos.example.org/a.jpeg")).toBe("optimize");
    expect(photoRoute("https://d1abc.cloudfront.net/x/y/z.webp")).toBe("optimize");
  });

  it("asks the sample CDN for a width instead", () => {
    expect(photoRoute(UNSPLASH)).toBe("self");
  });

  it("leaves the site's own files, SVGs and non-http URLs alone", () => {
    expect(photoRoute("/team/andrea.jpg")).toBe("as-is");
    expect(photoRoute("https://cdn.example/logo.SVG")).toBe("as-is");
    expect(photoRoute("data:image/png;base64,AAAA")).toBe("as-is");
    expect(photoRoute("not a url")).toBe("as-is");
  });
});

describe("photoUrl", () => {
  it("builds exactly the URL Next's own loader builds, with our config", () => {
    const config = {
      ...imageConfigDefault,
      ...nextConfig.images,
      path: "/_next/image",
    } as Parameters<typeof defaultLoader>[0]["config"];
    for (const w of ALL_WIDTHS) {
      expect(photoUrl(MLS, w)).toBe(
        defaultLoader({ config, src: MLS, width: w, quality: PHOTO_QUALITY }),
      );
    }
  });

  it("encodes the whole original URL, query string included", () => {
    const url = new URL(photoUrl(MLS, 800), "http://site");
    expect(url.pathname).toBe("/_next/image");
    expect(url.searchParams.get("url")).toBe(MLS);
    expect(url.searchParams.get("w")).toBe("800");
    expect(url.searchParams.get("q")).toBe(String(PHOTO_QUALITY));
  });

  it("only ever asks for a width the optimizer allows", () => {
    expect(allowedWidth(1)).toBe(THUMB_WIDTHS[0]);
    expect(allowedWidth(481)).toBe(640);
    expect(allowedWidth(99_999)).toBe(PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1]);
    expect(photoUrl(MLS, 504)).toContain("&w=640&");
  });

  it("sets the sample CDN's own w parameter and keeps its other ones", () => {
    const url = new URL(photoUrl(UNSPLASH, 480));
    expect(url.searchParams.get("w")).toBe("480");
    expect(url.searchParams.get("q")).toBe("80");
    expect(url.searchParams.get("fit")).toBe("crop");
  });

  it("never rewrites an MLS URL's own parameters (the old /w=\\d+/ replace did)", () => {
    // "show=720" contains "w=720": the map preview used to turn it into "show=480".
    expect(new URL(photoUrl(MLS, 480), "http://site").searchParams.get("url")).toBe(MLS);
  });
});

describe("widthsFor", () => {
  it("offers every width from the smallest share of a narrow screen up", () => {
    expect(widthsFor("92vw")).toEqual(ALL_WIDTHS.filter((w) => w >= 0.92 * 480));
    expect(widthsFor("(min-width: 1024px) 26vw, 92vw")).toEqual(
      ALL_WIDTHS.filter((w) => w >= 0.26 * 480),
    );
  });

  it("caps thumbnails at 3× their size", () => {
    expect(widthsFor("80px")).toEqual([96, 160, 256]);
  });
});

describe("photoSources", () => {
  it("caps the phone srcset at PHONE_MAX_WIDTH and keeps larger widths for bigger screens", () => {
    const s = photoSources(MLS, "(min-width: 768px) 50vw, 100vw");
    const phone = candidates(s.phoneSrcSet);
    const all = candidates(s.srcSet);
    expect(Math.max(...phone.map(([, w]) => w))).toBe(PHONE_MAX_WIDTH);
    expect(Math.max(...all.map(([, w]) => w))).toBe(1920);
    for (const [url, w] of [...phone, ...all]) {
      expect(url).toBe(photoUrl(MLS, w));
      expect(url.startsWith("/_next/image?url=")).toBe(true);
    }
    expect(s.src).toBe(photoUrl(MLS, 1200));
  });

  it("never points a phone, or any screen, at the full-size original", () => {
    const s = photoSources(MLS, "100vw");
    expect(s.src).not.toBe(MLS);
    expect(`${s.srcSet} ${s.phoneSrcSet}`).not.toContain(`${MLS} `);
  });

  it("uses the sample CDN's widths for sample photos", () => {
    const s = photoSources(UNSPLASH, "92vw");
    const phone = candidates(s.phoneSrcSet);
    expect(phone.every(([url, w]) => new URL(url).searchParams.get("w") === String(w))).toBe(true);
    expect(Math.max(...phone.map(([, w]) => w))).toBe(PHONE_MAX_WIDTH);
  });

  it("passes the site's own files through untouched", () => {
    expect(photoSources("/brand/logo.png", "100vw")).toEqual({ src: "/brand/logo.png" });
  });
});

describe("next.config.ts images", () => {
  const images = nextConfig.images!;
  it("makes only the widths and quality <Photo> asks for", () => {
    expect([...(images.imageSizes ?? []), ...(images.deviceSizes ?? [])]).toEqual([
      ...ALL_WIDTHS,
    ]);
    expect(images.qualities).toEqual([PHOTO_QUALITY]);
    expect(images.formats).toEqual(["image/webp"]);
  });

  it("accepts photos from any http(s) host, and nothing else", () => {
    expect(images.remotePatterns).toEqual([
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ]);
    expect(images.unoptimized).toBeFalsy();
  });

  describe("private addresses (SSRF)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });
    const load = async (env: Record<string, string>) => {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      vi.resetModules();
      return (await import("../../next.config")).default.images!;
    };

    it("are refused in production", async () => {
      expect((await load({ NODE_ENV: "production", E2E_PHOTO_HOST: "" })).dangerouslyAllowLocalIP).toBe(false);
    });

    it("are allowed in development, and in a local production run only with E2E_PHOTO_HOST", async () => {
      expect((await load({ NODE_ENV: "development" })).dangerouslyAllowLocalIP).toBe(true);
      expect(
        (await load({ NODE_ENV: "production", E2E_PHOTO_HOST: "http://127.0.0.1:4010" }))
          .dangerouslyAllowLocalIP,
      ).toBe(true);
    });
  });
});
