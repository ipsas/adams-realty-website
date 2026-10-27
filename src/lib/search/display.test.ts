import { describe, expect, it } from "vitest";
import { resultsDisplay } from "./display";

const SIZE = 24;
const show = (
  p: Omit<Parameters<typeof resultsDisplay>[0], "page" | "pageSize"> & { page?: number },
) => resultsDisplay({ page: 1, pageSize: SIZE, ...p });

describe("resultsDisplay", () => {
  it("shows the total, the numbered pager and the empty state of a complete search", () => {
    expect(show({ incomplete: false, total: 60, pageCount: 3, itemCount: 24 })).toEqual({
      total: 60,
      pageCount: 3,
      empty: false,
      steps: null,
    });
    expect(show({ incomplete: false, total: 60, page: 3, pageCount: 3, itemCount: 12 })).toEqual({
      total: 60,
      pageCount: 3,
      empty: false,
      steps: null,
    });
    expect(show({ incomplete: false, total: 0, pageCount: 1, itemCount: 0 })).toEqual({
      total: 0,
      pageCount: 1,
      empty: true,
      steps: null,
    });
  });

  it("claims no total, numbered pager or 'no homes' for a timed-out search", () => {
    // A timed-out count beside a page of results.
    expect(show({ incomplete: true, total: null, pageCount: 2, itemCount: 24 })).toMatchObject({
      total: null,
      pageCount: 1,
      empty: false,
    });
    // Timed-out results: nothing came back, which isn't "no homes match"; nothing to page.
    expect(show({ incomplete: true, total: null, pageCount: 1, itemCount: 0 })).toEqual({
      total: null,
      pageCount: 1,
      empty: false,
      steps: null,
    });
    // Only the pins timed out: the count is real, but the page is incomplete.
    expect(show({ incomplete: true, total: 0, pageCount: 1, itemCount: 0 })).toEqual({
      total: null,
      pageCount: 1,
      empty: false,
      steps: null,
    });
  });

  it("still pages a timed-out count by Previous and Next", () => {
    const steps = (page: number, itemCount: number) =>
      show({ incomplete: true, total: null, page, pageCount: page, itemCount }).steps;
    // Page 1, full: only Next.
    expect(steps(1, SIZE)).toEqual({ prev: false, next: true });
    // Page 3, full: both.
    expect(steps(3, SIZE)).toEqual({ prev: true, next: true });
    // Page 3, short: it was the last, only Previous.
    expect(steps(3, SIZE - 5)).toEqual({ prev: true, next: false });
    // Page 1, short: nowhere to go.
    expect(steps(1, 3)).toEqual({ prev: false, next: false });
  });
});
