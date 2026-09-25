import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSearchParams } from "@/lib/search/params";
import { buildSearchHref, currentView, replaceViewParam } from "./use-search-nav";

const criteria = parseSearchParams({ q: "Decatur", beds: "3", sort: "newest", page: "4" });

describe("buildSearchHref", () => {
  it("applies the patch and resets to page 1", () => {
    expect(buildSearchHref(criteria, { beds: 4 })).toBe("/homes?q=Decatur&beds=4&sort=newest");
    expect(buildSearchHref(criteria, { beds: undefined })).toBe("/homes?q=Decatur&sort=newest");
  });

  it("keeps an explicit page", () => {
    expect(buildSearchHref(criteria, { page: 2 })).toBe(
      "/homes?q=Decatur&beds=3&sort=newest&page=2",
    );
  });

  it("appends the view param when given", () => {
    expect(buildSearchHref(criteria, { minPrice: 300_000 }, "list")).toBe(
      "/homes?q=Decatur&minPrice=300000&beds=3&sort=newest&view=list",
    );
    expect(buildSearchHref(parseSearchParams({}), {}, "map")).toBe("/homes?view=map");
    expect(buildSearchHref(criteria, {}, null)).toBe("/homes?q=Decatur&beds=3&sort=newest");
  });

  it("keeps the View amenity filter beside the sheet position", () => {
    const withAmenity = parseSearchParams(new URLSearchParams("q=Hartwell&view=1&view=list"));
    const href = buildSearchHref(withAmenity, { beds: 2 }, "list");
    expect(href).toBe("/homes?q=Hartwell&beds=2&view=1&view=list");
    const back = parseSearchParams(new URL(href, "http://x").searchParams);
    expect(back.view).toBe(true);
    expect(back.beds).toBe(2);
  });

  it("does not mutate the criteria", () => {
    buildSearchHref(criteria, { q: "Midtown" });
    expect(criteria.q).toBe("Decatur");
    expect(criteria.page).toBe(4);
  });
});

/** A minimal browser window at `href`, recording history.replaceState calls. */
function stubWindow(href: string, state: Record<string, unknown> | null = null) {
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { href, search: new URL(href).search },
    history: { state, replaceState },
  });
  return replaceState;
}

describe("currentView", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is undefined on the server", () => {
    expect(typeof window).toBe("undefined");
    expect(currentView()).toBeUndefined();
  });

  it("reads the sheet position from any of the URL's view values", () => {
    stubWindow("http://x/homes?q=Hartwell&view=1&view=list");
    expect(currentView()).toBe("list");
    stubWindow("http://x/homes?view=map&view=1");
    expect(currentView()).toBe("map");
  });

  it("ignores the amenity filter's view=1 and unknown values", () => {
    stubWindow("http://x/homes?view=1");
    expect(currentView()).toBeUndefined();
    stubWindow("http://x/homes?view=bogus");
    expect(currentView()).toBeUndefined();
  });
});

describe("replaceViewParam", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rewrites only the sheet position, keeping view=1 and the hash", () => {
    const replaceState = stubWindow("http://x/homes?q=Hartwell&view=1&view=list#top");
    replaceViewParam("map");
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][2]).toBe("/homes?q=Hartwell&view=1&view=map#top");
  });

  it("removes the sheet position when given null", () => {
    const replaceState = stubWindow("http://x/homes?view=1&view=list");
    replaceViewParam(null);
    expect(replaceState.mock.calls[0][2]).toBe("/homes?view=1");
  });

  it("does nothing when the position is unchanged, even beside view=1", () => {
    const withList = stubWindow("http://x/homes?view=1&view=list");
    replaceViewParam("list");
    expect(withList).not.toHaveBeenCalled();
    const amenityOnly = stubWindow("http://x/homes?view=1");
    replaceViewParam(null);
    expect(amenityOnly).not.toHaveBeenCalled();
  });

  it("keeps app state on the entry but hands Next none of its own keys", () => {
    const replaceState = stubWindow("http://x/homes", {
      dialog: "filters",
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: {},
    });
    replaceViewParam("list");
    expect(replaceState.mock.calls[0][0]).toEqual({ dialog: "filters" });
    expect(replaceState.mock.calls[0][2]).toBe("/homes?view=list");
  });
});
