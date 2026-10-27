import { describe, expect, it } from "vitest";
import { resultsDisplay } from "./display";

describe("resultsDisplay", () => {
  it("shows the total, the pager and the empty state of a complete search", () => {
    expect(resultsDisplay({ incomplete: false, total: 60, pageCount: 3, itemCount: 24 })).toEqual({
      total: 60,
      pageCount: 3,
      empty: false,
    });
    expect(resultsDisplay({ incomplete: false, total: 0, pageCount: 1, itemCount: 0 })).toEqual({
      total: 0,
      pageCount: 1,
      empty: true,
    });
  });

  it("claims no total, pager or 'no homes' for a timed-out search", () => {
    // A timed-out count beside a page of results.
    expect(resultsDisplay({ incomplete: true, total: null, pageCount: 2, itemCount: 24 })).toEqual({
      total: null,
      pageCount: 1,
      empty: false,
    });
    // Timed-out results: nothing came back, which isn't "no homes match".
    expect(resultsDisplay({ incomplete: true, total: null, pageCount: 1, itemCount: 0 })).toEqual({
      total: null,
      pageCount: 1,
      empty: false,
    });
    // Only the pins timed out: the count is real, but the page is incomplete.
    expect(resultsDisplay({ incomplete: true, total: 0, pageCount: 1, itemCount: 0 })).toEqual({
      total: null,
      pageCount: 1,
      empty: false,
    });
  });
});
