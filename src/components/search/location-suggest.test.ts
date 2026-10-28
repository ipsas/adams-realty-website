import { describe, expect, it } from "vitest";
import { shouldSuggest } from "./location-suggest";

// On /homes?q=Clay+County, retyping "Clay County" in the box showed no suggestions.
describe("shouldSuggest", () => {
  it("stays closed for the prefilled search, untouched", () => {
    expect(shouldSuggest("Clay County", "Clay County", false)).toBe(false);
  });

  it("suggests once the box is edited, even back to the same text", () => {
    expect(shouldSuggest("Clay County", "Clay County", true)).toBe(true);
  });

  it("suggests for text other than the prefilled search", () => {
    expect(shouldSuggest("Clay", "Clay County", false)).toBe(true);
    expect(shouldSuggest("Hall", "", true)).toBe(true);
  });

  it("needs at least 2 characters", () => {
    expect(shouldSuggest("C", "Clay County", true)).toBe(false);
    expect(shouldSuggest("", "", true)).toBe(false);
  });
});
