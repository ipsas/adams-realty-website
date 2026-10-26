import { describe, expect, it } from "vitest";
import { searchHref } from "@/lib/search/params";
import { placeHref } from "./links";

describe("placeHref", () => {
  it("links Braselton to its guide from any of its counties", () => {
    expect(placeHref("Braselton", "Jackson")).toBe("/areas/braselton");
    expect(placeHref("Braselton", "Barrow County")).toBe("/areas/braselton");
  });

  it("links a guide town in its own county to the guide", () => {
    expect(placeHref("Jefferson", "Jackson")).toBe("/areas/jefferson");
  });

  it("searches for a same-named place in another county", () => {
    expect(placeHref("Jefferson", "Chatham")).toBe(searchHref({ q: "Jefferson" }));
  });

  it("searches for a place with no guide", () => {
    expect(placeHref("Savannah", "Chatham")).toBe(searchHref({ q: "Savannah" }));
  });
});
