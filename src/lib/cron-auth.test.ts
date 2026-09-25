import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./cron-auth";

const req = (authorization?: string) =>
  new Request("http://localhost/api/cron/alerts", {
    headers: authorization ? { authorization } : {},
  });

describe("isCronAuthorized", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isCronAuthorized(req("Bearer s3cret"), "s3cret")).toBe(true);
    expect(isCronAuthorized(req("Bearer s3creT"), "s3cret")).toBe(false);
    expect(isCronAuthorized(req("s3cret"), "s3cret")).toBe(false);
    expect(isCronAuthorized(req(), "s3cret")).toBe(false);
  });

  it("stays closed when no secret is configured", () => {
    expect(isCronAuthorized(req("Bearer "), undefined)).toBe(false);
    expect(isCronAuthorized(req("Bearer undefined"), undefined)).toBe(false);
  });
});
