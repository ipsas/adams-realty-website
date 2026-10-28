/**
 * schema.org JSON-LD for the firm (RealEstateAgent) and its agents (Person); office hours are parsed from `site.hours`.
 * Pure: only facts from src/config/site.ts and the agents table, and the base
 * URL is passed in, so tests can cover every "settings lack X" case. Optional
 * properties are left out, never set to `undefined`.
 * The broker is the one employee, referenced by her agent page's Person @id; the other agents
 * link back via their own Person's worksFor.
 * Left out (no provided facts, or no data on every page): geo, sameAs, priceRange, ratings/reviews.
 */
import { telHref } from "@/components/content/contact";
import { site } from "@/config/site";
import { OG_DEFAULT_IMAGE } from "@/lib/og";

export type OpeningHours = { dayOfWeek: readonly string[]; opens: string; closes: string };

/** Structural subset of `site` the firm builder reads; `site` satisfies it. */
export type FirmSettings = {
  name: string;
  legalName: string;
  phone: string;
  email: string;
  address: { line1: string; city: string; state: string; postalCode: string };
  hours: string | null;
  brokerLicense: string | null;
  /** `slug` is the broker's agent page (/agents/<slug>). */
  broker: { name: string; slug: string };
  market: { stateName: string; counties: readonly string[] };
};

export type AgentProfile = {
  slug: string;
  name: string;
  title: string | null;
  phone: string | null;
  email: string;
  photoUrl: string | null;
};

export type PostalAddress = {
  "@type": "PostalAddress";
  streetAddress?: string;
  addressLocality: string;
  addressRegion: string;
  postalCode?: string;
  addressCountry: "US";
};

export type OpeningHoursSpecification = {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: readonly string[];
  opens: string;
  closes: string;
};

export type PropertyValue = { "@type": "PropertyValue"; propertyID: string; value: string };

export type AdministrativeArea = { "@type": "AdministrativeArea"; name: string };

export type RealEstateAgentJsonLd = {
  "@context": "https://schema.org";
  "@type": "RealEstateAgent";
  "@id": string;
  name: string;
  legalName: string;
  url: string;
  logo: string;
  image: string;
  telephone: string;
  email: string;
  address: PostalAddress;
  openingHoursSpecification?: OpeningHoursSpecification[];
  identifier?: PropertyValue;
  areaServed?: AdministrativeArea[];
  employee: { "@id": string };
};

export type PersonJsonLd = {
  "@context": "https://schema.org";
  "@type": "Person";
  "@id": string;
  name: string;
  url: string;
  jobTitle?: string;
  telephone?: string;
  email: string;
  image?: string;
  worksFor: { "@type": "RealEstateAgent"; "@id": string; name: string };
};

/** JSON for a `<script type="application/ld+json">`; escaping "<" keeps any text from closing the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function trimSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Absolute URL for a site path; already-absolute URLs are kept as they are. */
function absolute(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${trimSlash(baseUrl)}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** "(706) 246-0053" → "+17062460053". */
function e164(phone: string): string {
  return telHref(phone).replace(/^tel:/, "");
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const HOURS_RE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[–-](Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.m\.[–-](\d{1,2})(?::(\d{2}))?\s*([ap])\.m\.$/;

/** "9", undefined, "a" → "09:00"; null for an hour outside 1–12 or minutes outside 00–59. */
function toTime(h: string, mm: string | undefined, ap: string): string | null {
  const hour = Number(h);
  const minutes = mm === undefined ? 0 : Number(mm);
  if (hour < 1 || hour > 12 || minutes > 59) return null;
  const h24 = (hour % 12) + (ap === "p" ? 12 : 0);
  return `${String(h24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * `site.hours` ("Mon–Fri, 9 a.m.–5 p.m.") → { dayOfWeek: Monday…Friday, opens "09:00", closes "17:00" }.
 * Strict: null, any other wording, a range that wraps the week, or a close time not after the open
 * time returns null, and the caller omits openingHoursSpecification rather than guess.
 */
export function parseOfficeHours(hours: string | null): OpeningHours | null {
  const m = hours ? HOURS_RE.exec(hours) : null;
  if (!m) return null;
  const from = DAYS.indexOf(m[1] as (typeof DAYS)[number]);
  const to = DAYS.indexOf(m[2] as (typeof DAYS)[number]);
  if (to < from) return null;
  const opens = toTime(m[3], m[4], m[5]);
  const closes = toTime(m[6], m[7], m[8]);
  if (!opens || !closes || closes <= opens) return null;
  return { dayOfWeek: DAY_NAMES.slice(from, to + 1), opens, closes };
}

export function organizationId(baseUrl: string): string {
  return `${trimSlash(baseUrl)}/#organization`;
}

export function agentId(baseUrl: string, slug: string): string {
  return `${trimSlash(baseUrl)}/agents/${slug}#person`;
}

export function organizationJsonLd(
  baseUrl: string,
  settings: FirmSettings = site,
): RealEstateAgentJsonLd {
  const { address, hours, brokerLicense, market } = settings;
  const opening = parseOfficeHours(hours);
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": organizationId(baseUrl),
    name: settings.name,
    legalName: settings.legalName,
    url: `${trimSlash(baseUrl)}/`,
    // src/app/icon.svg, served at /icon.svg.
    logo: absolute(baseUrl, "/icon.svg"),
    image: absolute(baseUrl, OG_DEFAULT_IMAGE.url),
    telephone: e164(settings.phone),
    email: settings.email,
    address: {
      "@type": "PostalAddress",
      ...(address.line1.trim() ? { streetAddress: address.line1.trim() } : {}),
      addressLocality: address.city,
      addressRegion: address.state,
      ...(address.postalCode.trim() ? { postalCode: address.postalCode.trim() } : {}),
      addressCountry: "US",
    },
    ...(opening
      ? {
          openingHoursSpecification: [
            {
              "@type": "OpeningHoursSpecification" as const,
              dayOfWeek: opening.dayOfWeek,
              opens: opening.opens,
              closes: opening.closes,
            },
          ],
        }
      : {}),
    ...(brokerLicense
      ? {
          identifier: {
            "@type": "PropertyValue" as const,
            propertyID: "Georgia Real Estate Commission firm license",
            value: brokerLicense,
          },
        }
      : {}),
    ...(market.counties.length > 0
      ? {
          areaServed: market.counties.map((c) => ({
            "@type": "AdministrativeArea" as const,
            name: `${c} County, ${market.stateName}`,
          })),
        }
      : {}),
    employee: { "@id": agentId(baseUrl, settings.broker.slug) },
  };
}

export function agentJsonLd(
  agent: AgentProfile,
  baseUrl: string,
  settings: Pick<FirmSettings, "name"> = site,
): PersonJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": agentId(baseUrl, agent.slug),
    name: agent.name,
    url: absolute(baseUrl, `/agents/${agent.slug}`),
    ...(agent.title ? { jobTitle: agent.title } : {}),
    ...(agent.phone ? { telephone: e164(agent.phone) } : {}),
    email: agent.email,
    ...(agent.photoUrl ? { image: absolute(baseUrl, agent.photoUrl) } : {}),
    worksFor: { "@type": "RealEstateAgent", "@id": organizationId(baseUrl), name: settings.name },
  };
}
