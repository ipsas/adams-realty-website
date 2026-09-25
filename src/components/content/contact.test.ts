import { describe, expect, it } from "vitest";
import {
  addressLines,
  directionsHref,
  formatLongDate,
  hasStreetAddress,
  mailtoHref,
  telHref,
} from "./contact";

describe("telHref", () => {
  it("formats 10-digit US numbers as E.164", () => {
    expect(telHref("(404) 555-0142")).toBe("tel:+14045550142");
    expect(telHref("404.555.0142")).toBe("tel:+14045550142");
  });

  it("keeps a leading country code", () => {
    expect(telHref("+1 404 555 0142")).toBe("tel:+14045550142");
    expect(telHref("1-800-669-9777")).toBe("tel:+18006699777");
  });

  it("falls back to bare digits for anything else", () => {
    expect(telHref("711")).toBe("tel:711");
  });
});

describe("mailtoHref", () => {
  it("links the address", () => {
    expect(mailtoHref("hello@example.com")).toBe("mailto:hello@example.com");
  });

  it("encodes the subject", () => {
    expect(mailtoHref("hello@example.com", "Privacy request & more")).toBe(
      "mailto:hello@example.com?subject=Privacy%20request%20%26%20more",
    );
  });
});

describe("addressLines", () => {
  const full = { line1: "123 Peachtree St NE", city: "Atlanta", state: "GA", postalCode: "30303" };

  it("returns street and city lines", () => {
    expect(addressLines(full)).toEqual(["123 Peachtree St NE", "Atlanta, GA 30303"]);
  });

  it("drops an empty street line and ZIP", () => {
    expect(addressLines({ ...full, line1: "", postalCode: "" })).toEqual(["Atlanta, GA"]);
    expect(addressLines({ ...full, line1: "   " })).toEqual(["Atlanta, GA 30303"]);
  });

  it("handles a missing city", () => {
    expect(addressLines({ line1: "", city: "", state: "GA", postalCode: "" })).toEqual(["GA"]);
  });
});

describe("hasStreetAddress / directionsHref", () => {
  it("needs a street line", () => {
    const blank = { line1: "", city: "Atlanta", state: "GA", postalCode: "" };
    expect(hasStreetAddress(blank)).toBe(false);
    expect(directionsHref(blank)).toBeNull();
  });

  it("links a map search for the full address", () => {
    const href = directionsHref({
      line1: "1 Main St",
      city: "Decatur",
      state: "GA",
      postalCode: "30030",
    });
    expect(href).toBe(
      "https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Decatur%2C%20GA%2030030",
    );
  });
});

describe("formatLongDate", () => {
  it("spells out the month", () => {
    expect(formatLongDate("2026-09-25")).toBe("September 25, 2026");
    expect(formatLongDate("2027-01-01")).toBe("January 1, 2027");
  });

  it("rejects anything but YYYY-MM-DD", () => {
    expect(() => formatLongDate("Sept 25")).toThrow();
  });
});
