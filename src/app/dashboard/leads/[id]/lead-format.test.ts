import { describe, expect, it } from "vitest";
import {
  followUpGreeting,
  followUpSubject,
  formatLeadDateTime,
  homeLabel,
  mailtoHref,
  refererPath,
  smsHref,
  telHref,
} from "./lead-format";

const home = {
  addressLine1: "123 Oak St",
  unitNumber: null,
  city: "Decatur",
  state: "GA",
  postalCode: "30030",
  hideAddress: false,
};

describe("telHref / smsHref", () => {
  it("dials US numbers in E.164", () => {
    expect(telHref("(404) 555-0142")).toBe("tel:+14045550142");
    expect(telHref("404.555.0142")).toBe("tel:+14045550142");
    expect(telHref("1-404-555-0142")).toBe("tel:+14045550142");
    expect(smsHref("404 555 0142")).toBe("sms:+14045550142");
  });

  it("keeps an explicit international number", () => {
    expect(telHref("+44 20 7946 0958")).toBe("tel:+442079460958");
  });

  it("drops an extension", () => {
    expect(telHref("404-555-0142 x12")).toBe("tel:+14045550142");
    expect(telHref("404-555-0142 ext. 7")).toBe("tel:+14045550142");
  });

  it("returns null when there's nothing dialable", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref("call me")).toBeNull();
    expect(smsHref("12")).toBeNull();
  });
});

describe("mailtoHref", () => {
  it("encodes subject and body per RFC 6068", () => {
    expect(mailtoHref("avery@example.com", { subject: "Your tour of 123 Oak St" })).toBe(
      "mailto:avery@example.com?subject=Your%20tour%20of%20123%20Oak%20St",
    );
    expect(mailtoHref("a@example.com", { subject: "Hi & bye?", body: "Hi Avery,\n\n" })).toBe(
      "mailto:a@example.com?subject=Hi%20%26%20bye%3F&body=Hi%20Avery%2C%0D%0A%0D%0A",
    );
  });

  it("escapes characters that would break out of the address", () => {
    expect(mailtoHref("a+b@example.com")).toBe("mailto:a%2Bb@example.com");
    expect(mailtoHref("x@example.com?cc=boss@example.com")).toBe(
      "mailto:x@example.com%3Fcc%3Dboss@example.com",
    );
  });
});

describe("followUpSubject", () => {
  it("names the home for listing leads", () => {
    expect(followUpSubject({ type: "tour", listing: home })).toBe(
      "Your tour of 123 Oak St, Decatur",
    );
    expect(followUpSubject({ type: "offer", listing: home })).toBe(
      "Your offer on 123 Oak St, Decatur",
    );
    expect(followUpSubject({ type: "question", listing: { ...home, unitNumber: "4B" } })).toBe(
      "Your question about 123 Oak St #4B, Decatur",
    );
  });

  it("respects an address the seller withheld", () => {
    expect(followUpSubject({ type: "tour", listing: { ...home, hideAddress: true } })).toBe(
      "Your tour of the home in Decatur",
    );
    expect(homeLabel({ ...home, hideAddress: true })).toBe("the home in Decatur");
  });

  it("falls back when there's no home", () => {
    expect(followUpSubject({ type: "valuation", listing: null })).toBe(
      "Your home valuation request",
    );
    expect(followUpSubject({ type: "general", listing: null })).toBe(
      "Your message to Adams Realty",
    );
  });
});

describe("followUpGreeting", () => {
  it("uses the first name", () => {
    expect(followUpGreeting("Avery Thompson")).toBe("Hi Avery,\n\n");
    expect(followUpGreeting("  ")).toBe("Hi,\n\n");
  });
});

describe("formatLeadDateTime", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("shows market time with the zone abbreviation", () => {
    expect(formatLeadDateTime(new Date("2026-09-26T15:00:00Z"), now)).toBe(
      "Sat, Sep 26 · 11:00 AM EDT",
    );
    expect(formatLeadDateTime(new Date("2026-12-05T19:30:00Z"), now)).toBe(
      "Sat, Dec 5 · 2:30 PM EST",
    );
  });

  it("adds the year when it isn't this year", () => {
    expect(formatLeadDateTime(new Date("2025-03-03T17:00:00Z"), now)).toBe(
      "Mon, Mar 3, 2025 · 12:00 PM EST",
    );
  });
});

describe("refererPath", () => {
  it("keeps just the path and query", () => {
    expect(refererPath("https://adamsrealty.example/homes/123-oak?x=1")).toBe("/homes/123-oak?x=1");
  });

  it("ignores junk and truncates long paths", () => {
    expect(refererPath(undefined)).toBeNull();
    expect(refererPath("not a url")).toBeNull();
    const long = refererPath(`https://a.example/${"x".repeat(200)}`)!;
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });
});
