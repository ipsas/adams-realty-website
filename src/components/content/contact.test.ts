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
    expect(telHref("(706) 246-0053")).toBe("tel:+17062460053");
    expect(telHref("706.246.0053")).toBe("tel:+17062460053");
  });

  it("keeps a leading country code", () => {
    expect(telHref("+1 706 246 0053")).toBe("tel:+17062460053");
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
  const full = { line1: "69 Mill Street", city: "Royston", state: "GA", postalCode: "30662" };

  it("returns street and city lines", () => {
    expect(addressLines(full)).toEqual(["69 Mill Street", "Royston, GA 30662"]);
  });

  it("drops an empty street line and ZIP", () => {
    expect(addressLines({ ...full, line1: "", postalCode: "" })).toEqual(["Royston, GA"]);
    expect(addressLines({ ...full, line1: "   " })).toEqual(["Royston, GA 30662"]);
  });

  it("handles a missing city", () => {
    expect(addressLines({ line1: "", city: "", state: "GA", postalCode: "" })).toEqual(["GA"]);
  });
});

describe("hasStreetAddress / directionsHref", () => {
  it("needs a street line", () => {
    const blank = { line1: "", city: "Royston", state: "GA", postalCode: "" };
    expect(hasStreetAddress(blank)).toBe(false);
    expect(directionsHref(blank)).toBeNull();
  });

  it("links a map search for the full address", () => {
    const href = directionsHref({
      line1: "69 Mill Street",
      city: "Royston",
      state: "GA",
      postalCode: "30662",
    });
    expect(href).toBe(
      "https://www.google.com/maps/search/?api=1&query=69%20Mill%20Street%2C%20Royston%2C%20GA%2030662",
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
