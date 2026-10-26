import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { env } from "@/lib/env";
import {
  absoluteUrl,
  escapeHtml,
  leadDigestEmail,
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
  cityLine: "Lavonia, GA 30553",
  attribution: "Listed by Example Realty Group",
  ...over,
});

const alert = (over: Partial<Parameters<typeof savedSearchAlertEmail>[0]> = {}) =>
  savedSearchAlertEmail({
    searchName: "3+ bd homes in Lavonia",
    frequency: "daily",
    mode: "buy",
    newListings: [home()],
    newTotal: 1,
    priceCuts: [],
    priceCutTotal: 0,
    searchUrl: "https://adams.example/homes?q=Lavonia&sort=newest",
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
    expect(email.subject).toBe("12 new homes, 1 price cut: 3+ bd homes in Lavonia");
    expect(email.html).toContain("12 new homes and 1 price cut");
    expect(email.html).toContain("See all 12 new homes");
    expect(email.html).toContain("Price cut $15,000");
    expect(email.text).toContain("See all 12 new homes: https://adams.example/homes?q=Lavonia");
  });

  it("uses rental and sold wording", () => {
    expect(alert({ mode: "rent" }).subject).toBe("1 new rental: 3+ bd homes in Lavonia");
    expect(alert({ mode: "sold", newTotal: 2 }).subject).toBe(
      "2 homes just sold: 3+ bd homes in Lavonia",
    );
    expect(
      alert({ newListings: [], newTotal: 0, priceCuts: [home()], priceCutTotal: 1 }).subject,
    ).toBe("1 price cut: 3+ bd homes in Lavonia");
  });

  it("escapes user-provided text in HTML but not in plain text", () => {
    const email = alert({ searchName: `<script>alert("x")</script> & co` });
    expect(email.html).not.toContain("<script>alert");
    expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
    expect(email.text).toContain(`<script>alert("x")</script> & co`);
  });

  it("carries the unsubscribe link, the firm's legal name, phone and address, and disclaimers", () => {
    const email = alert({
      disclaimers: ["MLS data deemed reliable.", "MLS data deemed reliable."],
    });
    for (const out of [email.html, email.text]) {
      expect(out).toContain("https://adams.example/alerts/unsubscribe?token=abc");
      expect(out).toContain(escapeHtml(site.legalName));
      expect(out).toContain(site.phone);
      expect(out).toContain(
        `${site.address.city}, ${site.address.state} ${site.address.postalCode}`,
      );
      expect(out).toContain("MLS data deemed reliable.");
    }
    expect(email.html.match(/MLS data deemed reliable/g)).toHaveLength(1);
  });

  it("renders listing rows with attribution and resized photos", () => {
    const { html, text } = alert();
    expect(html).toContain("Listed by Example Realty Group");
    expect(html).toContain("w=504");
    expect(html).toContain("$485,000");
    expect(text).toContain("3 bd · 2.5 ba · 1,850 sqft\n123 Oak St, Lavonia, GA 30553");
    const noPhoto = alert({ newListings: [home({ photoUrl: null })] });
    expect(noPhoto.html).toContain("Photo coming soon");
  });

  it("sends an MLS photo resized by the site's optimizer, never full size", () => {
    const mls = "https://media.mls.example/p/1.jpg?x=1";
    const { html } = alert({ newListings: [home({ photoUrl: mls })] });
    const src = /<img src="([^"]+)" width="168"/.exec(html)![1].replace(/&amp;/g, "&");
    const url = new URL(src);
    expect(url.origin).toBe(new URL(env.NEXT_PUBLIC_SITE_URL).origin);
    expect(url.pathname).toBe("/_next/image");
    expect(url.searchParams.get("url")).toBe(mls);
    expect(Number(url.searchParams.get("w"))).toBeLessThanOrEqual(640);
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

describe("Georgia MLS credit", () => {
  const year = new Date().getFullYear();
  const mlsUpdatedAt = new Date("2026-10-26T17:57:00Z");
  const notice = `© ${year} Georgia MLS. All rights reserved. IDX information is provided exclusively for consumers' personal, non-commercial use, that it may not be used for any purpose other than to identify prospective properties consumers may be interested in purchasing, and that the data is deemed reliable but is not guaranteed accurate by GAMLS. Last updated Oct 26, 2026, 1:57 PM ET`;
  const disclaimers = ["Other MLS text."];
  const homesUpdate = () =>
    savedHomesUpdateEmail({
      homes: [home()],
      savedUrl: "https://adams.example/saved",
      unsubscribeUrl: "https://adams.example/alerts/unsubscribe?token=h",
      manageUrl: "https://adams.example/account#alerts",
      disclaimers,
      mlsUpdatedAt,
    });

  it("alert emails credit Georgia MLS once: name, logo, copyright and disclaimer", () => {
    for (const email of [alert({ disclaimers, mlsUpdatedAt }), homesUpdate()]) {
      for (const out of [email.html, email.text]) {
        expect(out).toContain("Listings courtesy of Georgia MLS.");
        expect(out).toContain(`Listing information © ${year} Georgia MLS. All rights reserved.`);
        expect(out).not.toContain("© 2021");
      }
      expect(email.html.split(escapeHtml(notice)).length - 1).toBe(1);
      expect(email.html.split("Other MLS text.").length - 1).toBe(1);
      expect(email.text.split(notice).length - 1).toBe(1);
      expect(email.html).toContain(`src="${escapeHtml(absoluteUrl("/brand/gamls_idx.png"))}"`);
      expect(email.html).toContain('alt="Georgia MLS"');
    }
  });

  it("lead and password emails carry no MLS credit", () => {
    const lead = leadNotificationEmail({
      subject: "New question from Jane Doe",
      type: "question",
      name: "Jane Doe",
      email: "jane@example.com",
      source: "listing",
      dashboardUrl: "https://adams.example/dashboard/leads/abc",
    });
    const reset = passwordResetEmail({ name: "Casey", url: "https://adams.example/reset" });
    for (const email of [lead, reset]) {
      expect(email.html).not.toContain("courtesy of Georgia MLS");
    }
  });

  it("shows the listing firm in type as large as the listing text", () => {
    const { html } = alert();
    const style = /<div style="([^"]*)">Listed by Example Realty Group<\/div>/.exec(html)?.[1];
    expect(style).toContain("font-size:14px");
  });
});

describe("leadNotificationEmail", () => {
  it("lays out the lead's details and keeps line breaks in their message", () => {
    const email = leadNotificationEmail({
      subject: "Tour request: 123 Oak St, Lavonia, GA 30553",
      type: "tour",
      name: "Jordan Rivers",
      email: "jordan@example.com",
      phone: "(706) 555-0199",
      message: "Saturday works.\nWe're pre-approved.",
      tourLabel: "Sat, Sep 26, 10:00 AM EDT",
      tourType: "video",
      listing: home(),
      listingPlace: "123 Oak St",
      source: "listing",
      dashboardUrl: "https://adams.example/dashboard/leads/1",
      assignedAgentName: "Daniel Brooks",
    });
    expect(email.subject).toBe("Tour request: 123 Oak St, Lavonia, GA 30553");
    expect(email.html).toContain("Jordan Rivers wants to tour 123 Oak St");
    expect(email.html).toContain('href="tel:7065550199"');
    expect(email.html).toContain("Saturday works.<br>We&#39;re pre-approved.");
    expect(email.text).toContain("> Saturday works.\n> We're pre-approved.");
    expect(email.text).toContain("Tour type: Video tour");
    expect(email.text).toContain("Open this lead: https://adams.example/dashboard/leads/1");
    expect(email.html).not.toContain("Unsubscribe");
  });

  it("names the area instead of a withheld address", () => {
    const email = leadNotificationEmail({
      subject: "Tour request: Lavonia, GA 30553",
      type: "tour",
      name: "Jane Doe",
      email: "jane@example.com",
      listing: home({ street: "Address withheld by seller" }),
      listingPlace: "a home in Lavonia, GA 30553",
      source: "listing",
      dashboardUrl: "https://adams.example/dashboard/leads/2",
    });
    expect(email.text).toContain("Jane Doe wants to tour a home in Lavonia, GA 30553");
    const question = leadNotificationEmail({
      subject: "New question from Jane Doe",
      type: "question",
      name: "Jane Doe",
      email: "jane@example.com",
      listingPlace: "a home in Lavonia, GA 30553",
      source: "listing",
      dashboardUrl: "https://adams.example/dashboard/leads/3",
    });
    expect(question.text).toContain("Jane Doe asked about a home in Lavonia, GA 30553");
  });

  const base = {
    subject: "New question from Jane Doe",
    type: "question",
    name: "Jane Doe",
    email: "jane@example.com",
    source: "listing",
    dashboardUrl: "https://adams.example/dashboard/leads/abc",
  };

  it("tells the broker it's her copy, says who has the lead and how to turn copies off", () => {
    const copy = leadNotificationEmail({
      ...base,
      assignedAgentName: "Daniel Brooks",
      audience: "copy",
      settingsUrl: "https://adams.example/dashboard/settings",
    });
    expect(copy.subject).toBe("New question from Jane Doe");
    expect(copy.text).toContain("Your copy: this lead went to Daniel Brooks.");
    expect(copy.text).toContain("Open this lead: https://adams.example/dashboard/leads/abc");
    expect(copy.text).toContain(
      "Turn copies off in Email settings: https://adams.example/dashboard/settings",
    );
    expect(copy.text).not.toContain("Reply to this email");
    const unassigned = leadNotificationEmail({ ...base, audience: "copy" });
    expect(unassigned.text).toContain("went to the office inbox and isn't assigned");
  });

  it("tells an agent who assigned them the lead", () => {
    const email = leadNotificationEmail({
      ...base,
      assignedAgentName: "Daniel Brooks",
      audience: "assigned",
      assignedByName: "Andrea Anderegg",
    });
    expect(email.subject).toBe("Assigned to you: New question from Jane Doe");
    expect(email.text).toContain(
      "Andrea Anderegg assigned this lead to you. Reply to this email to answer Jane directly.",
    );
    expect(email.html).toContain('href="https://adams.example/dashboard/leads/abc"');
    expect(email.text).not.toContain("Email settings");
  });
});

describe("leadDigestEmail", () => {
  const section = (title: string, n: number, alert?: string) => ({
    title,
    total: n,
    items: Array.from({ length: Math.min(n, 2) }, (_, i) => ({
      name: `${title} ${i + 1}`,
      detail: "Question · 12 Oak St, Royston",
      alert: alert ?? null,
      href: `https://adams.example/dashboard/leads/${title[0]}${i}`,
    })),
  });
  const input = {
    firstName: "Andrea",
    office: true,
    dateLabel: "Tuesday, September 29",
    waitRule: "2 office hours (Mon–Fri, 9–5)",
    dashboardUrl: "https://adams.example/dashboard",
    settingsUrl: "https://adams.example/dashboard/settings",
  };

  it("lists only the sections with something in them, each lead linked, with its red note", () => {
    const email = leadDigestEmail({
      ...input,
      waiting: section("Waiting too long", 3, "Waiting 4 days"),
      tours: section("Tours in the next 48 hours", 0),
      followUps: section("Follow-ups due", 1),
    });
    expect(email.subject).toBe("Today: 3 leads waiting, 1 follow-up");
    expect(email.text).toContain("Good morning, Andrea");
    expect(email.text).toContain("across the office");
    expect(email.text).toContain("WAITING TOO LONG (3)");
    expect(email.text).toContain(
      "- Waiting too long 1 (Waiting 4 days)\n  Question · 12 Oak St, Royston\n  https://adams.example/dashboard/leads/W0",
    );
    // Two shown of three: a link to the rest.
    expect(email.text).toContain("See all 3 in the dashboard: https://adams.example/dashboard");
    expect(email.text).not.toContain("TOURS IN THE NEXT 48 HOURS");
    expect(email.text).toContain("FOLLOW-UPS DUE (1)");
    expect(email.html).toContain("Waiting 4 days");
    expect(email.text).toContain(
      "Change which emails you get: https://adams.example/dashboard/settings",
    );
  });

  it("speaks to one agent about their own leads", () => {
    const email = leadDigestEmail({
      ...input,
      firstName: "Daniel",
      office: false,
      waiting: section("Waiting too long", 0),
      tours: section("Tours in the next 48 hours", 1),
      followUps: section("Follow-ups due", 0),
    });
    expect(email.subject).toBe("Today: 1 tour");
    expect(email.text).toContain("What needs your attention on Tuesday, September 29.");
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
