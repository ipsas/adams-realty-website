import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

// Used by sign-in, sign-up and the preview unlock form (more cases in preview-gate.test.ts).
describe("safeNext", () => {
  it("keeps same-site paths, as a browser resolves them", () => {
    expect(safeNext("/homes?q=Royston&mode=rent")).toBe("/homes?q=Royston&mode=rent");
    expect(safeNext("/homes/1-main-st-a1b2c3d#photos")).toBe("/homes/1-main-st-a1b2c3d#photos");
    expect(safeNext("/saved")).toBe("/saved");
    expect(safeNext("/./saved")).toBe("/saved");
    expect(safeNext("/dashboard/../saved")).toBe("/saved");
  });

  it("refuses anything a browser or Next's router would follow off the site", () => {
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "evil.example",
      "/\t/evil.example",
      // Dot segments resolve to "//evil.example": the router follows that protocol-relative.
      "/.//evil.example",
      "/a/..//evil.example",
      "/%2e//evil.example",
      "/%2e%2e//evil.example",
      "/./\\evil.example",
      "/.\\/evil.example",
    ]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBe("/");
      expect(new URL(safeNext(bad), "https://site.test/sign-in").origin).toBe("https://site.test");
    }
  });

  it("uses the fallback for missing values and the first of several", () => {
    expect(safeNext(undefined, "/dashboard")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("/.//evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNext(["/saved", "//evil.example"])).toBe("/saved");
  });
});
