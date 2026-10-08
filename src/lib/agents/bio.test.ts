import { describe, expect, it } from "vitest";
import { bioExcerpt, bioParagraphs } from "./bio";

describe("bioParagraphs", () => {
  it("has nothing to show for a missing or blank bio", () => {
    expect(bioParagraphs(null)).toEqual([]);
    expect(bioParagraphs(undefined)).toEqual([]);
    expect(bioParagraphs("")).toEqual([]);
    expect(bioParagraphs(" \n\n \n")).toEqual([]);
  });

  it("keeps a one-paragraph bio whole", () => {
    expect(bioParagraphs("  Serving Northeast Georgia.  ")).toEqual(["Serving Northeast Georgia."]);
  });

  it("splits paragraphs at blank lines, however they were typed", () => {
    const bio = "First one.\n\nSecond one.\r\n\r\nThird one.\n \n\n\nFourth one.";
    expect(bioParagraphs(bio)).toEqual(["First one.", "Second one.", "Third one.", "Fourth one."]);
  });

  it("leaves a single line break inside its paragraph", () => {
    expect(bioParagraphs("Line one\nline two.\n\nNext.")).toEqual(["Line one\nline two.", "Next."]);
  });
});

describe("bioExcerpt", () => {
  it("is null without a bio", () => {
    expect(bioExcerpt(null)).toBeNull();
    expect(bioExcerpt("\n\n")).toBeNull();
  });

  it("joins paragraphs into one line", () => {
    expect(bioExcerpt("One.\n\nTwo\nthree.")).toBe("One. Two three.");
  });

  it("cuts a long bio at a word, within the limit", () => {
    const bio = `${"word ".repeat(50)}end.`;
    const out = bioExcerpt(bio, 40)!;
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toMatch(/^word( word)*…$/);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(bioExcerpt("Buyers, sellers, investors and everyone else", 18)).toBe("Buyers, sellers…");
  });
});
