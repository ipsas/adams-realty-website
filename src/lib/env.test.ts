import { describe, expect, it } from "vitest";
import { makeSchema, vercelSiteUrl } from "./env";

const siteUrl = (strict: boolean, e: Record<string, string | undefined> = {}) =>
  makeSchema(strict, e).shape.NEXT_PUBLIC_SITE_URL;

describe("NEXT_PUBLIC_SITE_URL", () => {
  it("takes the configured value in production", () => {
    expect(siteUrl(true).parse("https://www.adamsrealty.com")).toBe("https://www.adamsrealty.com");
  });

  it("strips trailing slashes", () => {
    expect(siteUrl(true).parse("https://www.adamsrealty.com/")).toBe("https://www.adamsrealty.com");
    expect(siteUrl(false).parse("http://localhost:3000//")).toBe("http://localhost:3000");
  });

  it("is required in production, never a deploy host", () => {
    const result = siteUrl(true, {
      VERCEL_ENV: "production",
      VERCEL_URL: "adams-abc123.vercel.app",
    }).safeParse(undefined);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("NEXT_PUBLIC_SITE_URL is required in production");
  });

  it("falls back to the preview deployment, else localhost, outside production", () => {
    expect(
      siteUrl(false, { VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "adams-git-qa.vercel.app" }).parse(
        undefined,
      ),
    ).toBe("https://adams-git-qa.vercel.app");
    expect(siteUrl(false).parse(undefined)).toBe("http://localhost:3000");
  });

  it("depends on VERCEL_ENV, not strict (NODE_ENV is production on previews too)", () => {
    expect(
      siteUrl(true, { VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "adams-git-qa.vercel.app" }).parse(
        undefined,
      ),
    ).toBe("https://adams-git-qa.vercel.app");
    expect(siteUrl(true, { VERCEL_ENV: "production" }).safeParse(undefined).success).toBe(false);
  });
});

describe("vercelSiteUrl", () => {
  it("is undefined in production, whatever deploy hosts exist", () => {
    expect(
      vercelSiteUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "adams.vercel.app",
        VERCEL_URL: "adams-abc123.vercel.app",
      }),
    ).toBeUndefined();
  });

  it("prefers the branch URL on previews", () => {
    expect(
      vercelSiteUrl({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "adams-git-qa.vercel.app",
        VERCEL_URL: "adams-abc123.vercel.app",
      }),
    ).toBe("https://adams-git-qa.vercel.app");
    expect(vercelSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: "adams-abc123.vercel.app" })).toBe(
      "https://adams-abc123.vercel.app",
    );
  });
});
