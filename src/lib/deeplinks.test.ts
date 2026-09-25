import { describe, expect, it } from "vitest";
import {
  directionsHrefs,
  isApplePlatform,
  mailtoHref,
  smsHref,
  telHref,
  toE164,
} from "./deeplinks";

describe("toE164", () => {
  it("normalizes US numbers written many ways", () => {
    expect(toE164("(404) 555-0142")).toBe("+14045550142");
    expect(toE164("404.555.0142")).toBe("+14045550142");
    expect(toE164("1-404-555-0142")).toBe("+14045550142");
    expect(toE164("+1 404 555 0142")).toBe("+14045550142");
    expect(toE164("404-555-0142 ext. 12")).toBe("+14045550142");
    expect(toE164("404-555-0142 x12")).toBe("+14045550142");
  });

  it("passes international numbers through", () => {
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects numbers that can't be dialed", () => {
    expect(toE164("555-0142")).toBeNull();
    expect(toE164("(104) 555-0142")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164("call me")).toBeNull();
  });
});

describe("tel, sms and mailto", () => {
  it("builds dialer and messages links", () => {
    expect(telHref("(404) 555-0142")).toBe("tel:+14045550142");
    expect(telHref("nope")).toBeNull();
    expect(smsHref("(404) 555-0142")).toBe("sms:+14045550142");
    expect(smsHref("(404) 555-0142", "Hi Jo, this is Dan from Adams Realty & co")).toBe(
      "sms:+14045550142?&body=Hi%20Jo%2C%20this%20is%20Dan%20from%20Adams%20Realty%20%26%20co",
    );
  });

  it("builds mailto links with %20 spaces", () => {
    expect(mailtoHref("hello@adamsrealty.example")).toBe("mailto:hello@adamsrealty.example");
    expect(
      mailtoHref(" hello@adamsrealty.example ", { subject: "Tour: 12 Oak St", body: "Hi there" }),
    ).toBe("mailto:hello@adamsrealty.example?subject=Tour%3A%2012%20Oak%20St&body=Hi%20there");
  });
});

describe("directionsHrefs", () => {
  const listing = {
    lat: 33.7748,
    lng: -84.2963,
    address: "123 Oak St, Decatur, GA 30030",
  };

  it("links Apple Maps, Google Maps and Street View", () => {
    const d = directionsHrefs(listing)!;
    expect(d.apple).toBe(
      "https://maps.apple.com/?daddr=123%20Oak%20St%2C%20Decatur%2C%20GA%2030030&dirflg=d",
    );
    expect(d.google).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=123%20Oak%20St%2C%20Decatur%2C%20GA%2030030&travelmode=driving",
    );
    expect(d.streetView).toBe(
      "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=33.7748%2C-84.2963",
    );
  });

  it("returns null when the address is suppressed", () => {
    expect(directionsHrefs({ ...listing, hideAddress: true })).toBeNull();
  });

  it("falls back to coordinates, and needs something to go to", () => {
    expect(directionsHrefs({ ...listing, address: "" })!.google).toContain(
      "destination=33.7748%2C-84.2963",
    );
    expect(directionsHrefs({ ...listing, lat: null, lng: null })!.streetView).toBeNull();
    expect(directionsHrefs({ lat: null, lng: null, address: null })).toBeNull();
  });
});

describe("isApplePlatform", () => {
  it("detects iOS, iPadOS and macOS", () => {
    expect(
      isApplePlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
    expect(
      isApplePlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe(true);
    expect(
      isApplePlatform(
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
    expect(isApplePlatform("")).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });
});
