import { describe, expect, it } from "vitest";
import { enterTarget } from "./location-enter";

// QA L21-3: Enter on "Jackson" with the County suggestion listed first goes to the county.
const items = ["Jackson County", "Jackson", "Jackson Lake"];

describe("enterTarget", () => {
  it("follows the first suggestion of an open list for the current text", () => {
    expect(enterTarget(items, "Jackson", "Jackson", -1, true)).toBe("Jackson County");
  });

  it("follows the arrow-selected suggestion", () => {
    expect(enterTarget(items, "Jackson", "Jackson", 1, true)).toBe("Jackson");
  });

  it("searches the text when the list is closed", () => {
    expect(enterTarget(items, "Jackson", "Jackson", -1, false)).toBeUndefined();
  });

  it("searches the text when the list is for older text (still loading)", () => {
    expect(enterTarget(items, "Jacks", "Jackson", -1, true)).toBeUndefined();
  });

  it("searches the text when there are no suggestions", () => {
    expect(enterTarget([], "Jackson", "Jackson", -1, true)).toBeUndefined();
    expect(enterTarget([], "", "Jackson", -1, false)).toBeUndefined();
  });
});
