import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { MlsAttribution, MlsMark } from "./mls-attribution";

/**
 * The Georgia MLS mark (IDX agreement §7): the official logo files from
 * gamls.com/logos, configured in site.ts → mls.logo. The text wordmark is
 * only the fallback for a missing setting.
 */

type Logo = { light: string; dark: string; width: number; height: number } | null;
const configured: Logo = site.mls.logo;
/** `site` is a readonly constant; the tests swap the logo setting in and out. */
const mls = site.mls as { logo: Logo };
afterEach(() => {
  mls.logo = configured;
});

const FIXTURE = {
  light: "/brand/fixture-light.svg",
  dark: "/brand/fixture-dark.svg",
  width: 150,
  height: 43,
};

function imgs(html: string) {
  return [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    return { src: attr("src"), alt: attr("alt"), cls: attr("class") ?? "" };
  });
}

describe("MlsMark", () => {
  it("falls back to the name as a text wordmark if no logo is configured", () => {
    mls.logo = null;
    const html = renderToStaticMarkup(createElement(MlsMark));
    expect(html).toContain('data-mls-mark="text"');
    expect(html).toContain(`>${site.mls.name}</span>`);
    expect(imgs(html)).toEqual([]);
  });

  it("shows the standard logo in light mode and the reverse logo in dark", () => {
    const html = renderToStaticMarkup(createElement(MlsMark));
    expect(html).toContain('data-mls-mark="logo"');
    expect(html).not.toContain('data-mls-mark="text"');

    const [light, dark, ...rest] = imgs(html);
    expect(rest).toEqual([]);
    expect(light.src).toBe("/brand/gamls_logo.svg");
    expect(dark.src).toBe("/brand/gamls_logo_reverse.svg");
    for (const img of [light, dark]) expect(img.alt).toBe(site.mls.name);
    // Exactly one shows per theme, at a fixed height and its own width (never stretched).
    for (const img of [light, dark])
      expect(img.cls.split(" ")).toEqual(expect.arrayContaining(["h-8", "w-auto"]));
    expect(light.cls.split(" ")).toContain("dark:hidden");
    expect(light.cls.split(" ")).not.toContain("hidden");
    expect(dark.cls.split(" ")).toEqual(expect.arrayContaining(["hidden", "dark:block"]));
  });

  it("renders whatever logo paths are configured", () => {
    mls.logo = FIXTURE;
    const [light, dark] = imgs(renderToStaticMarkup(createElement(MlsMark)));
    expect([light.src, dark.src]).toEqual([FIXTURE.light, FIXTURE.dark]);
  });

  it("carries the mark and the copyright notice in the attribution block", () => {
    const html = renderToStaticMarkup(createElement(MlsAttribution));
    expect(html).toContain('data-mls-mark="logo"');
    expect(html).toContain(`Listings courtesy of ${site.mls.name}.`);
    expect(html).toContain(`© ${new Date().getFullYear()} ${site.mls.copyrightHolder}`);
  });
});

describe("site.mls.logo", () => {
  const viewBox = (svg: string) =>
    svg
      .match(/<svg\b[^>]*\bviewBox="([^"]+)"/)?.[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);

  it("is the official Georgia MLS artwork: two existing SVGs, standard and reverse", () => {
    const logo = configured;
    expect(logo, "site.mls.logo must be set to the official files").not.toBeNull();
    expect(logo!.light).toBe("/brand/gamls_logo.svg");
    expect(logo!.dark).toBe("/brand/gamls_logo_reverse.svg");
    for (const src of [logo!.light, logo!.dark]) {
      const file = join(process.cwd(), "public", src);
      expect(existsSync(file), `${src} is missing from public/`).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg).toMatch(/<svg\b/);
      // Static artwork only: an <img> wouldn't run a script, but nothing else belongs there.
      expect(svg).not.toMatch(/<script|\son\w+=|<foreignObject|xlink:href="(?!#)|href="http/i);
    }
  });

  it("keeps the artwork's aspect ratio, so it is never stretched", () => {
    const logo = configured!;
    for (const src of [logo.light, logo.dark]) {
      const [, , w, h] = viewBox(readFileSync(join(process.cwd(), "public", src), "utf8"))!;
      expect(w / h, src).toBeCloseTo(488.86865 / 141.28671, 5);
      // The whole-pixel width × height is the artwork's ratio, to within a tenth of a pixel.
      expect(Math.abs(logo.width - (logo.height * w) / h), src).toBeLessThan(0.1);
    }
  });
});
