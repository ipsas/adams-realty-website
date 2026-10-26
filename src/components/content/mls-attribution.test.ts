import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { MlsAttribution, MlsCredit, MlsMark } from "./mls-attribution";

/**
 * The Georgia MLS mark (IDX agreement §7): the official GAMLS IDX logo
 * supplied by Georgia MLS, configured in site.ts → mls.logo. The text
 * wordmark is only the fallback for a missing setting.
 */

type Logo = { src: string; width: number; height: number } | null;
const configured: Logo = site.mls.logo;
const configuredSmall: Logo = site.mls.logoSmall;
/** `site` is a readonly constant; the tests swap the logo settings in and out. */
const mls = site.mls as { logo: Logo; logoSmall: Logo };
afterEach(() => {
  mls.logo = configured;
  mls.logoSmall = configuredSmall;
});

const year = new Date().getFullYear();

function imgs(html: string) {
  return [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    return { src: attr("src"), alt: attr("alt"), cls: (attr("class") ?? "").split(" ") };
  });
}

/** The class list of the element carrying `data-mls-mark`. */
function markClasses(html: string): string[] {
  const tag = html.match(/<span\b[^>]*data-mls-mark="logo"[^>]*>/)?.[0] ?? "";
  return (tag.match(/\bclass="([^"]*)"/)?.[1] ?? "").split(" ");
}

describe("MlsMark", () => {
  it("falls back to the name as a text wordmark if no logo is configured", () => {
    mls.logo = null;
    const html = renderToStaticMarkup(createElement(MlsMark));
    expect(html).toContain('data-mls-mark="text"');
    expect(html).toContain(`>${site.mls.name}</span>`);
    expect(imgs(html)).toEqual([]);
  });

  it("shows the one official logo, 32 px tall, on a white chip in dark mode", () => {
    const html = renderToStaticMarkup(createElement(MlsMark));
    expect(html).toContain('data-mls-mark="logo"');
    expect(html).not.toContain('data-mls-mark="text"');

    const [img, ...rest] = imgs(html);
    expect(rest).toEqual([]);
    expect(img.src).toBe("/brand/gamls_idx.png");
    expect(img.alt).toBe(site.mls.name);
    // A fixed height and its own width (never stretched), in both themes.
    expect(img.cls).toEqual(expect.arrayContaining(["h-8", "w-auto"]));
    expect(img.cls).not.toContain("hidden");
    expect(img.cls).not.toContain("dark:hidden");
    expect(markClasses(html)).toContain("dark:bg-white");
  });

  it("draws the small size from the 81 × 32 file at its native 32 px", () => {
    const [img] = imgs(renderToStaticMarkup(createElement(MlsMark, { size: "sm" })));
    expect(img.src).toBe("/brand/gamls_idx_81x32.png");
    expect(img.alt).toBe(site.mls.name);
    expect(img.cls).toEqual(expect.arrayContaining(["h-8", "w-auto"]));
    expect(img.cls).not.toContain("h-6");
  });

  it("falls back to the main logo for the small size", () => {
    mls.logoSmall = null;
    const [img] = imgs(renderToStaticMarkup(createElement(MlsMark, { size: "sm" })));
    expect(img.src).toBe("/brand/gamls_idx.png");
    expect(img.cls).toContain("h-8");
  });

  it("carries the mark and the copyright notice in the attribution block", () => {
    const html = renderToStaticMarkup(createElement(MlsAttribution));
    expect(html).toContain('data-mls-mark="logo"');
    expect(html).toContain(`Listings courtesy of ${site.mls.name}.`);
    expect(html).toContain(`© ${year} ${site.mls.copyrightHolder}`);
  });
});

describe("MlsCredit", () => {
  it("credits Georgia MLS compactly: the small logo and the copyright holder", () => {
    const html = renderToStaticMarkup(createElement(MlsCredit));
    expect(html).toContain("data-mls-credit");
    const [img, ...rest] = imgs(html);
    expect(rest).toEqual([]);
    expect(img.alt).toBe(site.mls.name);
    expect(img.src).toBe("/brand/gamls_idx_81x32.png");
    expect(img.cls).toContain("h-8");
    expect(html).toContain(`© ${year} ${site.mls.copyrightHolder}`);
  });
});

describe("site.mls.disclaimer", () => {
  it("is the fixed wording of GAMLS's notice, verbatim, without the year", () => {
    expect(site.mls.disclaimer).toBe("All rights reserved. Information is deemed reliable but is not guaranteed");
  });

  it("carries the consumer-use notice verbatim", () => {
    expect(site.mls.consumerUseNotice).toBe(
      "IDX information is provided exclusively for consumers' personal, non-commercial use, that it may not be used for any purpose other than to identify prospective properties consumers may be interested in purchasing, and that the data is deemed reliable but is not guaranteed accurate by GAMLS.",
    );
  });
});

describe("site.mls.logoSmall", () => {
  it("is the 81 × 32 GAMLS IDX logo file", () => {
    const logo = configuredSmall;
    expect(logo).toEqual({ src: "/brand/gamls_idx_81x32.png", width: 81, height: 32 });
    const png = readFileSync(join(process.cwd(), "public", logo!.src));
    expect(png.readUInt32BE(16)).toBe(81);
    expect(png.readUInt32BE(20)).toBe(32);
  });
});

describe("site.mls.logo", () => {
  it("is the official GAMLS IDX logo: an existing PNG of the configured size", () => {
    const logo = configured;
    expect(logo, "site.mls.logo must be set to the official file").not.toBeNull();
    expect(logo!.src).toBe("/brand/gamls_idx.png");
    const file = join(process.cwd(), "public", logo!.src);
    expect(existsSync(file), `${logo!.src} is missing from public/`).toBe(true);
    const png = readFileSync(file);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: width and height, so the <img> width/height keep the true ratio.
    expect(png.readUInt32BE(16)).toBe(logo!.width);
    expect(png.readUInt32BE(20)).toBe(logo!.height);
    expect(logo!.width / logo!.height).toBeCloseTo(300 / 118, 5);
  });
});
