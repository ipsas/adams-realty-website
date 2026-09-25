import { describe, expect, it } from "vitest";
import {
  diffProfile,
  formatPhone,
  nextAvailableSlug,
  parseAdminProfile,
  parseSelfProfile,
  splitList,
  toSlugBase,
} from "./admin-queries";

const base = {
  name: "Jordan Avery",
  email: "Jordan@AdamsRealty.example ",
  title: "",
  phone: "",
  bio: "",
  photoUrl: "",
  licenseNumber: "",
  specialties: "",
  languages: "",
  serviceAreas: "",
  yearsExperience: "",
};

describe("toSlugBase / nextAvailableSlug", () => {
  it("slugifies names, including accents", () => {
    expect(toSlugBase("José O'Neil-Smith")).toBe("jose-o-neil-smith");
  });

  it("falls back when the name has no Latin letters", () => {
    expect(toSlugBase("李明")).toBe("agent");
  });

  it("caps length without leaving a trailing hyphen", () => {
    const slug = toSlugBase(`${"a".repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("keeps a free slug and suffixes a taken one", () => {
    expect(nextAvailableSlug("jordan-avery", new Set())).toBe("jordan-avery");
    expect(nextAvailableSlug("jordan-avery", new Set(["jordan-avery"]))).toBe("jordan-avery-2");
    expect(nextAvailableSlug("jordan-avery", new Set(["jordan-avery", "jordan-avery-2"]))).toBe(
      "jordan-avery-3",
    );
  });
});

describe("splitList", () => {
  it("trims, drops blanks and de-duplicates case-insensitively", () => {
    expect(splitList(" Buckhead, sandy  springs,, buckhead ,\nDecatur")).toEqual([
      "Buckhead",
      "sandy springs",
      "Decatur",
    ]);
  });

  it("handles empty input", () => {
    expect(splitList("")).toEqual([]);
    expect(splitList(undefined)).toEqual([]);
  });
});

describe("formatPhone", () => {
  it("formats 10- and 11-digit US numbers", () => {
    expect(formatPhone("404.555.0142")).toBe("(404) 555-0142");
    expect(formatPhone("+1 404 555 0142")).toBe("(404) 555-0142");
  });

  it("keeps extensions and other numbers as typed", () => {
    expect(formatPhone("404-555-0142 x12")).toBe("404-555-0142 x12");
    expect(formatPhone("+44 20  7946 0958")).toBe("+44 20 7946 0958");
  });
});

describe("parseSelfProfile", () => {
  it("normalizes a valid profile", () => {
    const r = parseSelfProfile({
      ...base,
      phone: "4045550142",
      specialties: "Relocation, First-time buyers",
      yearsExperience: "7",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      name: "Jordan Avery",
      email: "jordan@adamsrealty.example",
      title: null,
      phone: "(404) 555-0142",
      photoUrl: null,
      specialties: ["Relocation", "First-time buyers"],
      languages: [],
      yearsExperience: 7,
    });
  });

  it("ignores admin-only fields an agent tries to submit", () => {
    const r = parseSelfProfile({
      ...base,
      isActive: "on",
      sortOrder: "0",
      slug: "someone-else",
      mlsAgentId: "HIJACK",
      officeId: "80c5b6ac-d529-431a-9cae-d2a22f43fee9",
      userId: "u1",
      id: "80c5b6ac-d529-431a-9cae-d2a22f43fee9",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const key of ["isActive", "sortOrder", "slug", "mlsAgentId", "officeId", "userId", "id"])
      expect(r.data).not.toHaveProperty(key);
  });

  it("returns one clear message per invalid field", () => {
    const r = parseSelfProfile({
      ...base,
      name: "J",
      email: "not-an-email",
      phone: "555-0142",
      photoUrl: "http://example.com/me.jpg",
      yearsExperience: "4.5",
      languages: Array.from({ length: 13 }, (_, i) => `Lang ${i}`).join(","),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(
      ["email", "languages", "name", "phone", "photoUrl", "yearsExperience"].sort(),
    );
    expect(r.errors.photoUrl).toMatch(/https/);
  });
});

describe("parseAdminProfile", () => {
  it("parses admin fields with sensible defaults", () => {
    const r = parseAdminProfile({ ...base, slug: "", mlsAgentId: "", officeId: "", sortOrder: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      slug: null,
      mlsAgentId: null,
      officeId: null,
      sortOrder: 0,
      isActive: false,
    });
  });

  it("slugifies a typed slug and reads the active checkbox", () => {
    const r = parseAdminProfile({ ...base, slug: " Jordan Avery GA ", isActive: "on" });
    expect(r.ok && r.data.slug).toBe("jordan-avery-ga");
    expect(r.ok && r.data.isActive).toBe(true);
  });

  it("treats an unusable slug as blank", () => {
    const r = parseAdminProfile({ ...base, slug: "!!!" });
    expect(r.ok && r.data.slug).toBeNull();
  });

  it("rejects a bad office id and out-of-range sort order", () => {
    const r = parseAdminProfile({ ...base, officeId: "main-office", sortOrder: "-1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.officeId).toBeDefined();
    expect(r.errors.sortOrder).toBeDefined();
  });
});

describe("diffProfile", () => {
  it("records only changed fields, summarizing the bio", () => {
    const before = { name: "A", bio: "old", languages: ["English"], phone: null };
    const after = { name: "A", bio: "new", languages: ["English", "Spanish"], phone: null };
    expect(diffProfile(before, after)).toEqual({
      bio: "edited",
      languages: { from: ["English"], to: ["English", "Spanish"] },
    });
  });
});
