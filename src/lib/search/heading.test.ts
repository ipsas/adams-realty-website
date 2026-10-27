import { describe, expect, it } from "vitest";
import { lakeName, searchHeading } from "./heading";
import {
  noResultsCopy,
  clearedFilters,
  countActiveFilters,
  describeCriteria,
  listingNoun,
  parseFromParam,
  parseSearchParams,
  serializeCriteria,
  SORT_LABELS,
} from "./params";

const c = (qs: string) => parseSearchParams(new URLSearchParams(qs));
const bounds = "bounds=-83.3,34.2,-83.1,34.4";

describe("searchHeading (site review #5)", () => {
  it("names a town as the listings spell it", () => {
    expect(searchHeading(c("q=hartwell"), { town: "Hartwell" })).toBe("Homes for sale in Hartwell");
    expect(searchHeading(c("q=Royston&mode=rent"), { town: "Royston" })).toBe("Rentals in Royston");
    expect(searchHeading(c("q=Royston&mode=sold"), { town: "Royston" })).toBe(
      "Sold homes in Royston",
    );
  });

  it("says 'near' for a lake", () => {
    expect(searchHeading(c("q=Lake Hartwell"))).toBe("Homes near Lake Hartwell");
    expect(searchHeading(c("q=Lanier"))).toBe("Homes near Lake Lanier");
    // A statewide lake without a guide.
    expect(searchHeading(c("q=Lake Oconee"))).toBe("Homes near Lake Oconee");
    expect(searchHeading(c("q=Lake Hartwell&types=land"))).toBe("Land near Lake Hartwell");
  });

  it("a town called Lake… is a town", () => {
    expect(searchHeading(c("q=Lake City"), { town: "Lake City" })).toBe(
      "Homes for sale in Lake City",
    );
    expect(lakeName("Lake City", "Lake City")).toBeUndefined();
  });

  it("a moved map is 'this map area'", () => {
    expect(searchHeading(c(bounds))).toBe("Homes in this map area");
    expect(searchHeading(c(`${bounds}&types=land`))).toBe("Land in this map area");
    expect(searchHeading(c(`${bounds}&mode=rent`))).toBe("Rentals in this map area");
  });

  it("follows the property-type filter", () => {
    expect(searchHeading(c("types=land"))).toBe("Land for sale in Georgia");
    expect(searchHeading(c("types=land,farm_ranch"))).toBe("Land & farms for sale in Georgia");
    expect(searchHeading(c("types=commercial"))).toBe("Commercial property for sale in Georgia");
    expect(searchHeading(c("types=land&mode=sold"))).toBe("Sold land in Georgia");
    expect(searchHeading(c("types=condo&mode=rent"))).toBe("Condos for rent in Georgia");
    expect(searchHeading(c("types=land&q=Carnesville"), { town: "Carnesville" })).toBe(
      "Land for sale in Carnesville",
    );
    // A mix reads as homes.
    expect(searchHeading(c("types=single_family,condo"))).toBe("Homes for sale in Georgia");
    expect(searchHeading(c(""))).toBe("Homes for sale in Georgia");
  });

  it("keeps other places as typed", () => {
    expect(searchHeading(c("q=Virginia-Highland"))).toBe("Homes for sale in Virginia-Highland");
    expect(searchHeading(c("q=30643"))).toBe("Homes for sale in 30643");
  });
});

describe("listingNoun and describeCriteria", () => {
  it("names what's listed", () => {
    expect(listingNoun(c(""))).toBe("Homes for sale");
    expect(listingNoun(c(""), { bare: true })).toBe("Homes");
    expect(listingNoun(c("mode=sold&types=land,farm_ranch"))).toBe("Sold land & farms");
    expect(describeCriteria(c("q=Royston&types=land,farm_ranch"))).toBe("Land & farms in Royston");
  });
});

describe("the from param (Back to the town)", () => {
  it("is read from the URL, trimmed, and is not a search criterion", () => {
    expect(parseFromParam(new URLSearchParams(`${bounds}&from=Royston`))).toBe("Royston");
    expect(parseFromParam(new URLSearchParams("from=%20%20"))).toBeUndefined();
    expect(parseFromParam({ from: "x".repeat(200) })).toHaveLength(120);
    const crit = c(`${bounds}&from=Royston`);
    expect(serializeCriteria(crit).has("from")).toBe(false);
  });
});

describe("clearedFilters", () => {
  it("turns off every counted filter and keeps the place, mode and sort", () => {
    const busy = c(
      "q=Royston&mode=sold&sort=newest&minPrice=1&maxPrice=9&beds=3&baths=2&types=land&minSqft=1&maxSqft=9&minLotSqft=1&minYear=1990&maxYear=2000&maxHoa=100&maxDaysOnMarket=7&pending=1&pool=1&garage=1&waterfront=1&view=1&basement=1&newConstruction=1&singleStory=1&openHouse=1&virtualTour=1&ourListings=1&fireplace=1&minAcres=1&maxAcres=5&hoa=no&kw=barn&priceReduced=1&age55=exclude",
    );
    expect(countActiveFilters(busy)).toBe(26);
    const cleared = { ...busy, ...clearedFilters() };
    expect(countActiveFilters(cleared)).toBe(0);
    expect(cleared.q).toBe("Royston");
    expect(cleared.mode).toBe("sold");
    expect(cleared.sort).toBe("newest");
  });
});

describe("land sorts (site review #8)", () => {
  it("are labelled for land buyers", () => {
    expect(SORT_LABELS.lot_desc).toBe("Acreage (most first)");
    expect(SORT_LABELS.price_per_acre_asc).toBe("Price per acre");
    expect(c("sort=lot_desc").sort).toBe("lot_desc");
    expect(c("sort=price_per_acre_asc").sort).toBe("price_per_acre_asc");
  });
});

describe("noResultsCopy (site review #5)", () => {
  it("speaks of rentals on a rentals search, and claims only what the search checked", () => {
    const rent = noResultsCopy({ mode: "rent" }, "in Carnesville");
    expect(rent.heading).toBe("No rentals match — yet");
    expect(rent.alert).toBe("Email me when rentals list here");
    expect(rent.none).toBe("No rentals in Carnesville right now.");
    for (const text of Object.values(rent)) {
      expect(text).not.toMatch(/\bhomes\b/i);
      expect(text).not.toMatch(/nothing is listed/i);
    }
  });

  it("keeps home words for homes, and names the type on a typed search", () => {
    expect(noResultsCopy({ mode: "buy" }, "in Royston")).toEqual({
      heading: "No homes match — yet",
      alert: "Email me when homes list here",
      none: "No homes for sale in Royston right now.",
    });
    expect(noResultsCopy({ mode: "buy", types: ["land"] }, "in this map area").none).toBe(
      "No land for sale in this map area right now.",
    );
    expect(noResultsCopy({ mode: "sold" }, "in Georgia").none).toBe("No recent sales in Georgia.");
  });
});
