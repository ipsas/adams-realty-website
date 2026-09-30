import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { busyPageHtml, retryHref, waitPhrase } from "./busy-page";

describe("the 429 page", () => {
  const html = busyPageHtml({ retryAfter: 45, pathname: "/homes", search: "?q=Royston&_rsc=abc" });

  it("is branded and friendly, with Try again, Back, sign-in and the office phone", () => {
    expect(html).toContain("<h1>One moment, please</h1>");
    expect(html).toContain(`<title>One moment, please | ${site.name}</title>`);
    expect(html).toContain('href="/homes?q=Royston" data-testid="busy-retry">Try again</a>');
    expect(html).toContain('data-testid="busy-back"');
    expect(html).toContain("history.back()");
    expect(html).toContain(`href="tel:+1${site.phone.replace(/\D/g, "")}"`);
    expect(html).toContain(site.phone);
    expect(html).toContain(`/sign-in?next=${encodeURIComponent("/homes?q=Royston")}`);
    expect(html).toContain("Please try again in a minute.");
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("follows the site's theme choice and the device setting, in both palettes", () => {
    expect(html).toContain('localStorage.getItem("ar:theme")');
    expect(html).toContain('@media (prefers-color-scheme: dark){:root:not([data-theme="light"])');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toMatch(/--canvas:#fbfaf7/);
    expect(html).toMatch(/--canvas:#0f1412/);
  });

  it("needs nothing from outside: no external scripts, styles or fonts", () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("escapes the address it links back to", () => {
    const evil = busyPageHtml({
      retryAfter: 5,
      pathname: "/homes",
      search: '?q="><script>x</script>',
    });
    expect(evil).not.toContain("<script>x</script>");
    expect(evil).toContain('href="/homes?q=%22%3E%3Cscript%3Ex%3C%2Fscript%3E"');
  });

  it("says how long to wait in plain words", () => {
    expect(waitPhrase(30)).toBe("in a minute");
    expect(waitPhrase(600)).toBe("in about 10 minutes");
    expect(waitPhrase(3 * 3600)).toBe("in about 3 hours");
    expect(waitPhrase(3600 + 1800)).toBe("in about 2 hours");
    expect(retryHref("/homes/a", "")).toBe("/homes/a");
    expect(retryHref("/homes", "?_rsc=1")).toBe("/homes");
  });
});
