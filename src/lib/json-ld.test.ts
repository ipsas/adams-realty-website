import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import {
  type AgentProfile,
  agentId,
  agentJsonLd,
  organizationId,
  organizationJsonLd,
  parseOfficeHours,
  serializeJsonLd,
} from "./json-ld";

const base = "https://www.example.com";

describe("serializeJsonLd", () => {
  it("escapes < so text can't close the script tag", () => {
    const out = serializeJsonLd({ a: "</script><b>" });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script");
  });

  it("round-trips", () => {
    const x = { a: "</script>", b: [1, { c: "d <e>" }], f: null };
    expect(JSON.parse(serializeJsonLd(x))).toEqual(x);
  });
});

describe("organizationJsonLd", () => {
  const json = organizationJsonLd(base);

  it("has the firm's required fields from settings", () => {
    expect(json["@context"]).toBe("https://schema.org");
    expect(json["@type"]).toBe("RealEstateAgent");
    expect(json.name).toBe(site.name);
    expect(json.legalName).toBe(site.legalName);
    expect(json.url).toBe(`${base}/`);
    expect(json.telephone).toBe("+17062460053");
    expect(json.email).toBe(site.email);
    expect(json.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "69 Mill Street",
      addressLocality: "Royston",
      addressRegion: "GA",
      postalCode: "30662",
      addressCountry: "US",
    });
  });

  it("has a stable @id without a double slash", () => {
    expect(json["@id"]).toBe(organizationId(base));
    expect(json["@id"]).toBe(`${base}/#organization`);
    expect(organizationJsonLd(base)["@id"]).toBe(json["@id"]);
    expect(organizationJsonLd(`${base}/`)["@id"]).toBe(`${base}/#organization`);
  });

  it("emits office hours parsed from site.hours", () => {
    expect(json.openingHoursSpecification?.[0]).toEqual({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "09:00",
      closes: "17:00",
    });
  });

  it("follows a changed hours string", () => {
    const changed = organizationJsonLd(base, { ...site, hours: "Mon–Sat, 8 a.m.–6 p.m." });
    expect(changed.openingHoursSpecification?.[0]).toEqual({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      opens: "08:00",
      closes: "18:00",
    });
  });

  it("omits office hours when unset", () => {
    const none = organizationJsonLd(base, { ...site, hours: null });
    expect("openingHoursSpecification" in none).toBe(false);
  });

  it("omits office hours it can't parse", () => {
    const none = organizationJsonLd(base, { ...site, hours: "By appointment" });
    expect("openingHoursSpecification" in none).toBe(false);
  });

  it("emits the GREC firm license, and omits it when unset", () => {
    expect(json.identifier?.value).toBe("6079");
    expect(json.identifier?.propertyID).toBe("Georgia Real Estate Commission firm license");
    const none = organizationJsonLd(base, { ...site, brokerLicense: null });
    expect("identifier" in none).toBe(false);
  });

  it("serves the firm's counties, and omits areaServed when there are none", () => {
    expect(json.areaServed).toHaveLength(site.market.counties.length);
    expect(json.areaServed).toHaveLength(7);
    expect(json.areaServed?.[0]).toEqual({
      "@type": "AdministrativeArea",
      name: "Franklin County, Georgia",
    });
    const none = organizationJsonLd(base, { ...site, market: { ...site.market, counties: [] } });
    expect("areaServed" in none).toBe(false);
  });

  it("leaves out a blank street line", () => {
    const noStreet = organizationJsonLd(base, { ...site, address: { ...site.address, line1: "" } });
    expect("streetAddress" in noStreet.address).toBe(false);
    expect(noStreet.address.addressLocality).toBe("Royston");
  });

  it("has no undefined values", () => {
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    const sparse = organizationJsonLd(base, {
      ...site,
      hours: null,
      brokerLicense: null,
      address: { ...site.address, line1: "", postalCode: "" },
      market: { ...site.market, counties: [] },
    });
    expect(JSON.parse(JSON.stringify(sparse))).toEqual(sparse);
    expect(Object.values(sparse)).not.toContain(undefined);
  });

  it("has no TODO or placeholder values", () => {
    const out = serializeJsonLd(json);
    expect(out).not.toContain("TODO");
    expect(out).not.toContain("instagram.com/");
  });

  it("is identical across pages", () => {
    // `/`, `/about` and `/contact` render the same component, which takes no per-page input.
    expect(serializeJsonLd(organizationJsonLd(base))).toBe(
      serializeJsonLd(organizationJsonLd(base)),
    );
  });
});

describe("parseOfficeHours", () => {
  const weekdays = {
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    opens: "09:00",
    closes: "17:00",
  };

  it("parses the current settings string", () => {
    expect(parseOfficeHours(site.hours)).toEqual(weekdays);
  });

  it("accepts hyphens as range separators", () => {
    expect(parseOfficeHours("Mon-Fri, 9 a.m.-5 p.m.")).toEqual(weekdays);
  });

  it("parses minutes and noon", () => {
    expect(parseOfficeHours("Tue–Thu, 10:30 a.m.–12 p.m.")).toEqual({
      dayOfWeek: ["Tuesday", "Wednesday", "Thursday"],
      opens: "10:30",
      closes: "12:00",
    });
  });

  it("returns null rather than guess", () => {
    expect(parseOfficeHours(null)).toBeNull();
    expect(parseOfficeHours("")).toBeNull();
    expect(parseOfficeHours("Sat–Mon, 9 a.m.–5 p.m.")).toBeNull();
    expect(parseOfficeHours("Mon–Fri, 5 p.m.–9 a.m.")).toBeNull();
    expect(parseOfficeHours("Mon–Fri, 13 a.m.–5 p.m.")).toBeNull();
  });
});

describe("agentJsonLd", () => {
  const andrea: AgentProfile = {
    slug: "andrea-anderegg",
    name: "Andrea Anderegg",
    title: "Broker",
    phone: "(850) 572-3287",
    email: "contracts.adamsrealty@gmail.com",
    photoUrl: "/team/andrea-anderegg.webp",
  };

  it("describes the agent as a Person working for the firm", () => {
    const json = agentJsonLd(andrea, base);
    expect(json["@type"]).toBe("Person");
    expect(json["@id"]).toBe(agentId(base, andrea.slug));
    expect(json["@id"]).toBe(`${base}/agents/andrea-anderegg#person`);
    expect(json.url).toBe(`${base}/agents/andrea-anderegg`);
    expect(json.name).toBe("Andrea Anderegg");
    expect(json.jobTitle).toBe("Broker");
    expect(json.telephone).toBe("+18505723287");
    expect(json.email).toBe(andrea.email);
    expect(json.image).toBe(`${base}/team/andrea-anderegg.webp`);
    expect(json.worksFor).toEqual({
      "@type": "RealEstateAgent",
      "@id": organizationId(base),
      name: site.name,
    });
  });

  it("keeps an absolute photo URL as it is", () => {
    const url = "https://cdn.example.com/a.webp";
    expect(agentJsonLd({ ...andrea, photoUrl: url }, base).image).toBe(url);
  });

  it("omits missing title, phone and photo but keeps the email", () => {
    const json = agentJsonLd({ ...andrea, title: null, phone: null, photoUrl: null }, base);
    expect("jobTitle" in json).toBe(false);
    expect("telephone" in json).toBe(false);
    expect("image" in json).toBe(false);
    expect(json.email).toBe(andrea.email);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("emits the office phone for agents who take calls at the office", () => {
    expect(agentJsonLd({ ...andrea, phone: site.phone }, base).telephone).toBe("+17062460053");
  });
});
