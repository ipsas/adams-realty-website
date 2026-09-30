import { describe, expect, it } from "vitest";
import {
  countLinks,
  formSignals,
  isSeoPitch,
  MIN_FILL_MS,
  parseSpamReasons,
  SPAM_REASON_LABELS,
} from "./spam";

describe("form signals", () => {
  const min = MIN_FILL_MS.message;

  it("passes a person: honeypot empty, form open a while", () => {
    expect(formSignals({ honeypot: "", elapsed: "8400", minMs: min })).toEqual([]);
    expect(formSignals({ honeypot: undefined, elapsed: String(min), minMs: min })).toEqual([]);
  });

  it("flags the honeypot, a form sent too fast, and one sent with no timer", () => {
    expect(formSignals({ honeypot: "https://spam.example", elapsed: "9000", minMs: min })).toEqual([
      "honeypot",
    ]);
    expect(formSignals({ honeypot: "", elapsed: "400", minMs: min })).toEqual(["too-fast"]);
    for (const elapsed of [undefined, null, "", "abc", "-5", "1e9"]) {
      expect(formSignals({ honeypot: "", elapsed, minMs: min }), String(elapsed)).toEqual([
        "no-timer",
      ]);
    }
    expect(formSignals({ honeypot: "x", elapsed: "10", minMs: min })).toEqual([
      "honeypot",
      "too-fast",
    ]);
  });

  it("reads stored reasons back, ignoring anything unknown", () => {
    expect(parseSpamReasons("honeypot,seo-pitch,bogus")).toEqual(["honeypot", "seo-pitch"]);
    expect(parseSpamReasons(undefined)).toEqual([]);
    for (const r of parseSpamReasons("honeypot,too-fast,no-timer,seo-pitch")) {
      expect(SPAM_REASON_LABELS[r]).toBeTruthy();
    }
  });
});

describe("the SEO-pitch filter", () => {
  // Shaped like the pitches the office received through the site's forms.
  const pitches = [
    "Hi, I was looking at your website and noticed it isn't showing up in Google's index for searches like 'homes for sale in Royston'. We can improve your search visibility and get you on the first page of Google. Free audit: https://rank-boost.example/audit",
    "Hello team, your site has great listings but weak SEO. Book a call: www.seo-pros.example",
    "Your website is not indexed on Google yet. Our SEO experts can fix that this week.",
    "We build high-authority backlinks that grow organic traffic for real estate brokers. Pricing at https://links.example",
    "Quick question — would you like more search engine visibility? See http://example.com/offer",
  ];

  it("flags SEO pitches: an SEO phrase with a link, or two SEO phrases", () => {
    for (const text of pitches) expect(isSeoPitch(text), text).toBe(true);
  });

  it("leaves buyers' and sellers' messages alone", () => {
    for (const text of [
      "Is this home still available? https://www.zillow.com/homedetails/123",
      "We'd like to see it Saturday morning. We're moving from Atlanta.",
      "How long do homes take to sell in Hart County? Will mine show up on Zillow and Google?",
      "Do you do digital marketing for your listings?",
      "Hi, this is Seo-yeon Park. Is the lake lot still for sale? https://www.adamsrealty.example/homes/1",
      "Here are the three I liked: https://a.example/1 https://a.example/2 https://a.example/3",
      "",
      null,
    ]) {
      expect(isSeoPitch(text), String(text)).toBe(false);
    }
  });

  it("counts web links, not email addresses", () => {
    expect(countLinks("see https://a.example and www.b.example/x, or mail me@c.example")).toBe(2);
  });
});
