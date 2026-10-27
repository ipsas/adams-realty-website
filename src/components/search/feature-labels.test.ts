import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS } from "@/lib/search/params";
import { FEATURE_ARIA_LABELS, FEATURE_LABELS } from "./feature-labels";

describe("feature labels", () => {
  it("starts every accessible name with the visible label", () => {
    for (const flag of FEATURE_FLAGS) {
      const aria = FEATURE_ARIA_LABELS[flag];
      if (aria) expect(aria.startsWith(FEATURE_LABELS[flag]), flag).toBe(true);
    }
  });

  it("names the primary-on-main checkbox with the word people search by", () => {
    const aria = FEATURE_ARIA_LABELS.primaryOnMain ?? "";
    expect(aria.startsWith("Primary bedroom on main")).toBe(true);
    expect(aria.toLowerCase()).toContain("master");
  });
});
