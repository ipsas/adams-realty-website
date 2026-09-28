import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { MlsAttribution, MlsMark } from "./mls-attribution";

/**
 * The Georgia MLS mark (IDX agreement §7). The official logo files are added
 * by hand (site.ts → mls.logo); these tests keep the logo branch working
 * before that happens, and make a wrong path fail once it does.
 */

type Logo = { light: string; dark: string; width: number; height: number } | null;
const configured: Logo = site.mls.logo;
/** `site` is a readonly constant; the tests swap the logo setting in and out. */
const mls = site.mls as { logo: Logo };
afterEach(() => {
  mls.logo = configured;
});

const FIXTURE = {
  light: "/brand/gamls-logo.svg",
  dark: "/brand/gamls-logo-reverse.svg",
  width: 150,
  height: 47,
};

function imgs(html: string) {
  return [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    return { src: attr("src"), alt: attr("alt"), cls: attr("class") ?? "" };
  });
}

describe("MlsMark", () => {
  it("shows the name as a text wordmark while no logo is configured", () => {
    mls.logo = null;
    const html = renderToStaticMarkup(createElement(MlsMark));
    expect(html).toContain('data-mls-mark="text"');
    expect(html).toContain(`>${site.mls.name}</span>`);
    expect(imgs(html)).toEqual([]);
  });

  it("shows the standard logo in light mode and the reverse logo in dark once configured", () => {
    mls.logo = FIXTURE;
    const html = renderToStaticMarkup(createElement(MlsMark));
    expect(html).toContain('data-mls-mark="logo"');
    expect(html).not.toContain('data-mls-mark="text"');

    const [light, dark, ...rest] = imgs(html);
    expect(rest).toEqual([]);
    expect(light.src).toBe(FIXTURE.light);
    expect(dark.src).toBe(FIXTURE.dark);
    for (const img of [light, dark]) expect(img.alt).toBe(site.mls.name);
    // Exactly one shows per theme.
    expect(light.cls.split(" ")).toContain("dark:hidden");
    expect(light.cls.split(" ")).not.toContain("hidden");
    expect(dark.cls.split(" ")).toEqual(expect.arrayContaining(["hidden", "dark:block"]));
  });

  it("carries the mark and the copyright notice in the attribution block", () => {
    mls.logo = FIXTURE;
    const html = renderToStaticMarkup(createElement(MlsAttribution));
    expect(html).toContain('data-mls-mark="logo"');
    expect(html).toContain(`Listings courtesy of ${site.mls.name}.`);
    expect(html).toContain(`© ${new Date().getFullYear()} ${site.mls.copyrightHolder}`);
  });
});

describe("site.mls.logo", () => {
  it("points at image files that exist under public/ when set", () => {
    const logo = configured;
    if (!logo) {
      // Not configured yet: the site renders the text wordmark (tested above).
      expect(logo).toBeNull();
      return;
    }
    expect(logo.light).not.toBe(logo.dark);
    expect(logo.width).toBeGreaterThan(0);
    expect(logo.height).toBeGreaterThan(0);
    for (const src of [logo.light, logo.dark]) {
      expect(src).toMatch(/^\/brand\/[\w.-]+\.(svg|png|webp)$/);
      const file = join(process.cwd(), "public", src);
      expect(existsSync(file), `${src} is missing from public/`).toBe(true);
      if (src.endsWith(".svg")) expect(readFileSync(file, "utf8")).toMatch(/<svg\b/);
    }
  });
});
