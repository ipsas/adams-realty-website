import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import {
  escapeHtml,
  leadNotificationEmail,
  listingFacts,
  passwordResetEmail,
  savedHomesUpdateEmail,
  savedSearchAlertEmail,
  type EmailListing,
} from "./email-templates";

const home = (over: Partial<EmailListing> = {}): EmailListing => ({
  href: "https://adams.example/homes/123-oak",
  photoUrl: "https://images.unsplash.com/photo-1?auto=format&w=1600",
  price: 485_000,
  bedrooms: 3,
  bathrooms: 2.5,
  livingAreaSqft: 1850,
  street: "123 Oak St",
  cityLine: "Decatur, GA 30030",
  attribution: "Listed by Peachtree Partners",
  ...over,
});

const alert = (over: Partial<Parameters<typeof savedSearchAlertEmail>[0]> = {}) =>
  savedSearchAlertEmail({
    searchName: "3+ bd homes in Decatur",
    frequency: "daily",
    mode: "buy",
    newListings: [home()],
    newTotal: 1,
    priceCuts: [],
    priceCutTotal: 0,
    searchUrl: "https://adams.example/homes?q=Decatur&sort=newest",
    unsubscribeUrl: "https://adams.example/alerts/unsubscribe?token=abc",
    manageUrl: "https://adams.example/saved",
    ...over,
  });

describe("escapeHtml", () => {
  it("escapes markup and attribute quotes", () => {
    expect(escapeHtml(`<b onclick="x">Tom & 'Jerry'</b>`)).toBe(
      "&lt;b onclick=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/b&gt;",
    );
  });
});

describe("listingFacts", () => {
  it("skips unknown values", () => {
    expect(listingFacts({ bedrooms: 3, bathrooms: 2.5, livingAreaSqft: 1850 })).toBe(
      "3 bd · 2.5 ba · 1,850 sqft",
    );
    expect(listingFacts({ bedrooms: null, bathrooms: 2, livingAreaSqft: null })).toBe("2 ba");
  });
});

describe("savedSearchAlertEmail", () => {
  it("summarizes new listings and price cuts in the subject and heading", () => {
    const email = alert({
      newListings: [home()],
      newTotal: 12,
      priceCuts: [home({ badge: { label: "Price cut $15,000", tone: "clay" } })],
      priceCutTotal: 1,
    });
    expect(email.subject).toBe("12 new homes, 1 price cut: 3+ bd homes in Decatur");
    expect(email.html).toContain("12 new homes and 1 price cut");
    expect(email.html).toContain("See all 12 new homes");
    expect(email.html).toContain("Price cut $15,000");
    expect(email.text).toContain("See all 12 new homes: https://adams.example/homes?q=Decatur");
  });

  it("uses rental and sold wording", () => {
    expect(alert({ mode: "rent" }).subject).toBe("1 new rental: 3+ bd homes in Decatur");
    expect(alert({ mode: "sold", newTotal: 2 }).subject).toBe(
      "2 homes just sold: 3+ bd homes in Decatur",
    );
    expect(
      alert({ newListings: [], newTotal: 0, priceCuts: [home()], priceCutTotal: 1 }).subject,
    ).toBe("1 price cut: 3+ bd homes in Decatur");
  });

  it("escapes user-provided text in HTML but not in plain text", () => {
    const email = alert({ searchName: `<script>alert("x")</script> & co` });
    expect(email.html).not.toContain("<script>alert");
    expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
    expect(email.text).toContain(`<script>alert("x")</script> & co`);
  });

  it("carries the unsubscribe link, the firm's legal name and phone, and disclaimers", () => {
    const email = alert({
      disclaimers: ["MLS data deemed reliable.", "MLS data deemed reliable."],
    });
    for (const out of [email.html, email.text]) {
      expect(out).toContain("https://adams.example/alerts/unsubscribe?token=abc");
      expect(out).toContain(escapeHtml(site.legalName));
      expect(out).toContain(site.phone);
      expect(out).toContain("MLS data deemed reliable.");
    }
    expect(email.html.match(/MLS data deemed reliable/g)).toHaveLength(1);
  });

  it("renders listing rows with attribution and resized photos", () => {
    const { html, text } = alert();
    expect(html).toContain("Listed by Peachtree Partners");
    expect(html).toContain("w=504");
    expect(html).toContain("$485,000");
    expect(text).toContain("3 bd · 2.5 ba · 1,850 sqft\n123 Oak St, Decatur, GA 30030");
    const noPhoto = alert({ newListings: [home({ photoUrl: null })] });
    expect(noPhoto.html).toContain("Photo coming soon");
  });
});

describe("savedHomesUpdateEmail", () => {
  it("names the home when there's one and counts when there are several", () => {
    const one = savedHomesUpdateEmail({
      homes: [
        home({ badge: { label: "Price cut $15,000", tone: "clay" }, notes: ["Was $500,000"] }),
      ],
      savedUrl: "https://adams.example/saved",
      unsubscribeUrl: "https://adams.example/alerts/unsubscribe?token=h",
      manageUrl: "https://adams.example/account#alerts",
    });
    expect(one.subject).toBe("Price cut $15,000: 123 Oak St");
    expect(one.text).toContain("Was $500,000");
    const many = savedHomesUpdateEmail({
      homes: [home(), home({ street: "9 Elm St" })],
      savedUrl: "https://adams.example/saved",
      unsubscribeUrl: "https://adams.example/alerts/unsubscribe?token=h",
      manageUrl: "https://adams.example/account#alerts",
    });
    expect(many.subject).toBe("Updates on 2 of your saved homes");
  });
});

describe("leadNotificationEmail", () => {
  it("lays out the lead's details and keeps line breaks in their message", () => {
    const email = leadNotificationEmail({
      subject: "Tour request: 123 Oak St, Decatur, GA 30030",
      type: "tour",
      name: "Jordan Rivers",
      email: "jordan@example.com",
      phone: "(404) 555-0199",
      message: "Saturday works.\nWe're pre-approved.",
      tourLabel: "Sat, Sep 26, 10:00 AM EDT",
      tourType: "video",
      listing: home(),
      source: "listing",
      dashboardUrl: "https://adams.example/dashboard/leads?focus=1",
      assignedAgentName: "Daniel Brooks",
    });
    expect(email.subject).toBe("Tour request: 123 Oak St, Decatur, GA 30030");
    expect(email.html).toContain("Jordan Rivers wants to tour 123 Oak St");
    expect(email.html).toContain('href="tel:4045550199"');
    expect(email.html).toContain("Saturday works.<br>We&#39;re pre-approved.");
    expect(email.text).toContain("> Saturday works.\n> We're pre-approved.");
    expect(email.text).toContain("Tour type: Video tour");
    expect(email.text).toContain(
      "Open lead in dashboard: https://adams.example/dashboard/leads?focus=1",
    );
    expect(email.html).not.toContain("Unsubscribe");
  });
});

describe("passwordResetEmail", () => {
  it("links the reset URL in the button and as copyable text", () => {
    const url = "https://adams.example/reset-password/tok?callbackURL=%2F";
    const email = passwordResetEmail({ name: "Casey Buyer", url });
    expect(email.subject).toBe(`Reset your ${site.name} password`);
    expect(email.html.split(escapeHtml(url)).length - 1).toBe(3); // button + link href + link text
    expect(email.text).toContain(`Choose a new password: ${url}`);
    expect(email.text).toContain("Hi Casey");
  });
});
