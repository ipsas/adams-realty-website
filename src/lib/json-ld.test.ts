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
  websiteId,
  websiteJsonLd,
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
    expect(json.telephone).toBe("+1-706-246-0053");
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
      name: "Hall County, Georgia",
    });
    const none = organizationJsonLd(base, { ...site, market: { ...site.market, counties: [] } });
    expect("areaServed" in none).toBe(false);
  });

  it("references the broker's agent Person as the employee", () => {
    expect(json.employee).toEqual({ "@id": `${base}/agents/andrea-anderegg#person` });
    expect(json.employee["@id"]).toBe(agentId(base, site.broker.slug));
  });

  it("has an absolute logo and image", () => {
    expect(json.logo).toBe(`${base}/icon.svg`);
    expect(json.image).toBe(`${base}/images/og-default.jpg`);
    expect(organizationJsonLd(`${base}/`).logo).toBe(`${base}/icon.svg`);
  });

  it("matches the production output, in key order", () => {
    const prod = organizationJsonLd("https://adamsrealtyga.com");
    expect(Object.keys(prod)).toEqual([
      "@context",
      "@type",
      "@id",
      "name",
      "alternateName",
      "legalName",
      "url",
      "logo",
      "image",
      "telephone",
      "email",
      "address",
      "openingHoursSpecification",
      "identifier",
      "areaServed",
      "employee",
    ]);
    expect(prod).toMatchObject({
      "@id": "https://adamsrealtyga.com/#organization",
      url: "https://adamsrealtyga.com/",
      logo: "https://adamsrealtyga.com/icon.svg",
      image: "https://adamsrealtyga.com/images/og-default.jpg",
      telephone: "+1-706-246-0053",
      email: "contracts.adamsrealty@gmail.com",
      employee: { "@id": "https://adamsrealtyga.com/agents/andrea-anderegg#person" },
    });
  });

  it("leaves out geo and sameAs", () => {
    expect("geo" in json).toBe(false);
    expect("sameAs" in json).toBe(false);
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

describe("business and WebSite nodes (BR-A1)", () => {
  const prodBase = "https://adamsrealtyga.com";
  const business = organizationJsonLd(prodBase);
  const website = websiteJsonLd(prodBase);

  it("gives the business node its brand names, phone and address", () => {
    expect(business["@id"]).toBe("https://adamsrealtyga.com/#organization");
    expect(business.alternateName).toEqual(["Adams Realty, Inc."]);
    expect(business.alternateName).toEqual([business.legalName]);
    expect(business.name).toBe("Adams Realty");
    expect(business.legalName).toBe("Adams Realty, Inc.");
    expect(business.url).toBe("https://adamsrealtyga.com/");
    expect(business.telephone).toBe("+1-706-246-0053");
    expect(business.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "69 Mill Street",
      addressLocality: "Royston",
      addressRegion: "GA",
      postalCode: "30662",
      addressCountry: "US",
    });
    expect("sameAs" in business).toBe(false);
  });

  it("emits the WebSite node published by the business, in key order", () => {
    expect(website).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": "https://adamsrealtyga.com/#website",
      name: "Adams Realty",
      alternateName: "Adams Realty, Inc.",
      url: "https://adamsrealtyga.com/",
      publisher: { "@id": "https://adamsrealtyga.com/#organization" },
    });
    expect(Object.keys(website)).toEqual([
      "@context",
      "@type",
      "@id",
      "name",
      "alternateName",
      "url",
      "publisher",
    ]);
  });

  it("gives the homepage graph unique @ids, with the website published by the organization", () => {
    const ids = [business["@id"], website["@id"]];
    expect(new Set(ids).size).toBe(ids.length);
    expect(website.publisher["@id"]).toBe(business["@id"]);
    expect(website.publisher["@id"]).toBe(organizationId(prodBase));
  });

  it("names the agent's employer by the organization @id", () => {
    const person = agentJsonLd(
      {
        slug: "andrea-anderegg",
        name: "Andrea Anderegg",
        title: "Broker",
        phone: null,
        email: "contracts.adamsrealty@gmail.com",
        photoUrl: null,
      },
      prodBase,
    );
    expect(person.worksFor["@id"]).toBe("https://adamsrealtyga.com/#organization");
    expect(person.worksFor["@id"]).toBe(business["@id"]);
  });

  it("links the two nodes by distinct @ids that survive serialization", () => {
    expect(website.publisher["@id"]).toBe(business["@id"]);
    expect(website["@id"]).not.toBe(business["@id"]);
    expect(JSON.parse(serializeJsonLd(business))).toEqual(business);
    expect(JSON.parse(serializeJsonLd(website))).toEqual(website);
  });

  it("gives the same ids for a trailing-slash base", () => {
    const slashed = `${prodBase}/`;
    expect(organizationJsonLd(slashed)["@id"]).toBe("https://adamsrealtyga.com/#organization");
    expect(websiteId(slashed)).toBe("https://adamsrealtyga.com/#website");
    expect(websiteJsonLd(slashed)).toEqual(website);
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
