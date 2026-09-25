/**
 * Seeds a development database with a realistic, fictional Metro Atlanta
 * market: one brokerage, eight sample agents, ~170 listings (ours plus a demo
 * MLS feed), open houses, price history, leads and demo logins.
 *
 *   npm run db:seed
 *
 * Listings are written through the same `upsertListing` pipeline the MLS
 * sync uses, so seeded data exercises the production code path.
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  agents,
  dataSources,
  inquiries,
  listingEvents,
  offices,
  savedListings,
  savedSearches,
  users,
} from "@/db/schema";
import { upsertListing, type PersistSource } from "@/lib/listings/persist";
import { slugify } from "@/lib/listings/slug";
import type { NormalizedListing, NormalizedMedia } from "@/lib/mls/types";
import {
  AGENTS,
  APPLIANCES,
  COMMUNITY,
  CONDO_EXTERIORS,
  CONDO_STREETS,
  EXTERIOR_FEATURES,
  EXTERIORS,
  FLOORING,
  HIGHLIGHTS,
  INTERIOR_FEATURES,
  INTERIORS,
  NEIGHBORHOODS,
  OPENERS,
  OTHER_BROKERAGES,
  STREETS,
  STYLES,
  SUFFIXES,
  type Neighborhood,
} from "./seed-data";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("Refusing to seed a production database. Pass --force if you really mean it.");
  process.exit(1);
}

// Deterministic PRNG so every developer gets the same data.
let state = 20260925;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
function sample<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length)
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}
function weighted<T extends string>(weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights) as [T, number][];
  let r = rand() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) {
    if ((r -= w) <= 0) return k;
  }
  return entries[0][0];
}

const NOW = new Date();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function roundPrice(p: number): number {
  const step = p < 500_000 ? 1_000 : p < 2_000_000 ? 5_000 : 25_000;
  return Math.round(p / step) * step;
}

function nextWeekend(offsetWeeks = 0): Date {
  const d = new Date(NOW);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((6 - day + 7) % 7 || 7) + offsetWeeks * 7);
  return d;
}

function buildMedia(type: string, count: number): NormalizedMedia[] {
  const front = type === "condo" ? pick(CONDO_EXTERIORS) : pick(EXTERIORS);
  const rooms = sample(INTERIORS, count - 1);
  return [
    { url: front, caption: "Exterior", kind: "photo" as const },
    ...rooms.map((r) => ({ url: r.url, caption: r.caption, kind: "photo" as const })),
  ].map((m, i) => ({ ...m, sourceKey: null, width: 1600, height: 1067, sortOrder: i }));
}

function describe(n: Neighborhood, type: string, beds: number, lotSqft: number): string {
  const opener = pick(OPENERS[type] ?? OPENERS.single_family)
    .replace("{style}", pick(STYLES))
    .replace("{hood}", n.name)
    .replace("{vibe}", n.vibe)
    .replace("{lotAdj}", lotSqft > 20_000 ? "sprawling" : lotSqft > 9_000 ? "generous" : "sunny")
    .replace("{view}", pick(["skyline views", "sweeping city views", "lake and sunset views"]))
    .replace("{beds}", String(beds))
    .replace("{acres}", (lotSqft / 43_560).toFixed(1));
  const body = type === "land" ? [] : sample(HIGHLIGHTS, 3);
  const closer = `All of it in ${n.name}, ${n.vibe}.`;
  return [opener, ...body, closer].join(" ");
}

type Generated = { listing: NormalizedListing; hood: Neighborhood; priceDropFrom?: number };

function generateListing(i: number, opts: { office: string; agentName?: string }): Generated {
  const hood = weightedHood();
  const type = weighted(hood.mix);
  const isLand = type === "land";
  const isCondo = type === "condo";

  // Skewed toward the small end, like real inventory: most homes are modest, a few are huge.
  const sqft = isLand
    ? null
    : Math.round((hood.sqft[0] + (hood.sqft[1] - hood.sqft[0]) * rand() ** 1.8) / 10) * 10;
  const beds = isLand
    ? null
    : Math.max(
        isCondo ? 0 : 2,
        Math.min(isCondo ? 4 : 7, Math.round((sqft ?? 0) / 650 + between(-0.6, 0.8))),
      );
  const bathsFull = isLand
    ? null
    : Math.max(1, Math.min(6, Math.round((beds ?? 1) * 0.75 + between(-0.3, 0.6))));
  const bathsHalf = isLand ? null : chance(0.45) ? 1 : 0;
  const lot = isCondo ? null : Math.max(2_000, Math.round(between(...hood.lot) / 10) * 10);
  const year = isLand ? null : intBetween(...hood.years);
  const ppsf = between(...hood.ppsf) * (year && year > 2015 ? 1.06 : 1);
  const salePrice = isLand
    ? roundPrice(((lot ?? 43_560) / 43_560) * between(45_000, 110_000) + 120_000)
    : roundPrice((sqft ?? 1000) * ppsf);
  // Luxury homes rarely hit the rental market.
  const mode = !isLand && salePrice < 1_200_000 && chance(isCondo ? 0.3 : 0.12) ? "rent" : "sale";
  const listPrice =
    mode === "rent" ? Math.round((salePrice * between(0.0045, 0.006)) / 25) * 25 : salePrice;

  const statusRoll = rand();
  const status: NormalizedListing["status"] =
    mode === "rent"
      ? statusRoll < 0.9
        ? "active"
        : "pending"
      : statusRoll < 0.66
        ? "active"
        : statusRoll < 0.71
          ? "coming_soon"
          : statusRoll < 0.8
            ? "active_under_contract"
            : statusRoll < 0.86
              ? "pending"
              : "closed";

  const dom =
    status === "coming_soon"
      ? -intBetween(2, 10)
      : status === "closed"
        ? intBetween(30, 200)
        : intBetween(1, 95);
  const listDate = daysAgo(dom);
  const priceDrop = mode === "sale" && status === "active" && dom > 20 && chance(0.35);
  const originalPrice = priceDrop ? roundPrice(listPrice * between(1.02, 1.07)) : listPrice;
  const closeDate = status === "closed" ? daysAgo(intBetween(3, Math.max(4, dom - 20))) : null;
  const closePrice = status === "closed" ? roundPrice(listPrice * between(0.95, 1.04)) : null;

  const stories = isLand ? null : isCondo ? 1 : chance(0.45) ? 1 : 2;
  const garage = isLand || isCondo ? (isCondo ? intBetween(1, 2) : null) : intBetween(1, 3);
  const pool = !isLand && !isCondo && chance(hood.poolChance ?? 0.08);
  const view = chance(hood.viewChance ?? 0.05);
  const waterfront = chance(hood.waterfrontChance ?? 0);
  const newConstruction = !!year && year >= NOW.getUTCFullYear() - 1 && mode === "sale";
  const hoa = isCondo
    ? intBetween(350, 1100)
    : type === "townhouse"
      ? intBetween(150, 400)
      : chance(0.35)
        ? intBetween(30, 120)
        : null;

  const angle = rand() * Math.PI * 2;
  const dist = Math.sqrt(rand()) * hood.radius;
  const lat = hood.lat + Math.sin(angle) * dist;
  // Longitude degrees are shorter at Atlanta's latitude (~1/cos 34°).
  const lng = hood.lng + Math.cos(angle) * dist * 1.2;

  const streetNumber = isCondo ? intBetween(100, 900) : intBetween(1000, 9999);
  const quadrant = hood.quadrant ? ` ${hood.quadrant}` : "";
  const street = isCondo
    ? `${pick(CONDO_STREETS)}${quadrant}`
    : `${pick(STREETS)} ${pick(SUFFIXES)}${quadrant}`;
  const unit = isCondo ? String(intBetween(3, 42) * 100 + intBetween(1, 12)) : null;

  const photoCount = isLand ? intBetween(2, 4) : intBetween(7, 14);
  // Georgia effective property-tax rates run roughly 0.8–1.2% of value.
  const taxes = mode === "sale" ? Math.round(salePrice * between(0.008, 0.012)) : null;

  const listing: NormalizedListing = {
    listingKey: `DEMO-${String(i).padStart(5, "0")}`,
    mlsNumber: String(4_100_000 + intBetween(0, 899_999)),
    status,
    transactionType: mode,
    propertyType: type,
    propertySubType: {
      single_family: "Single Family Residence",
      condo: "Condominium",
      townhouse: "Townhouse",
      multi_family: "Duplex",
      land: "Unimproved Land",
    }[type],
    listPrice,
    originalListPrice: originalPrice,
    closePrice,
    listDate: isoDate(listDate),
    closeDate: closeDate ? isoDate(closeDate) : null,
    bedrooms: beds,
    bathroomsFull: bathsFull,
    bathroomsHalf: bathsHalf,
    bathrooms: bathsFull === null ? null : bathsFull + 0.5 * (bathsHalf ?? 0),
    livingAreaSqft: sqft,
    lotSizeSqft: lot,
    yearBuilt: year,
    stories,
    garageSpaces: garage,
    hoaFee: hoa,
    hoaFrequency: hoa ? "monthly" : null,
    taxAnnualAmount: taxes,
    taxYear: taxes ? NOW.getUTCFullYear() - 1 : null,
    addressLine1: `${streetNumber} ${street}`,
    unitNumber: unit,
    city: hood.city,
    state: "GA",
    postalCode: hood.zip,
    county: hood.county,
    neighborhood: hood.name,
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lng * 1e6) / 1e6,
    hideAddress: false,
    headline: null,
    description: describe(hood, type, beds ?? 0, lot ?? 0),
    features: isLand
      ? {
          lot: sample(["Many Trees", "Views", "Level", "Sloped", "Native Plants"], 3),
          utilities: ["Electricity Available", "Well Needed"],
        }
      : {
          interior: sample(INTERIOR_FEATURES, intBetween(4, 7)),
          exterior: sample(EXTERIOR_FEATURES, intBetween(2, 4)),
          appliances: sample(APPLIANCES, intBetween(3, 6)),
          heating: [pick(["Central", "Natural Gas", "Heat Pump"])],
          cooling: ["Central Air"],
          parking: garage
            ? [`Garage (${garage} car)`, pick(["Attached", "Detached", "Garage Door Opener"])]
            : ["Street"],
          flooring: sample(FLOORING, 2),
          community: isCondo
            ? ["Concierge", "Fitness Center", "Pool", "Rooftop Deck"]
            : sample(COMMUNITY, intBetween(0, 3)),
          view: view
            ? [
                pick(
                  hood.waterfrontChance
                    ? ["Lake", "Water", "Trees/Woods"]
                    : ["City", "Skyline", "Trees/Woods", "Mountain(s)"],
                ),
              ]
            : [],
          construction: isCondo
            ? ["Concrete", "Glass"]
            : sample(["Brick", "Stone", "HardiPlank Type", "Stucco", "Wood Siding"], 2),
        },
    schools: {
      district: hood.district,
      // Generic sample names — real listings carry the MLS's school assignments.
      elementary: `${pick(["Oak Grove", "Brookside", "Heritage", "Willow Creek", "Parkview", "Magnolia"])} Elementary`,
      middle: `${pick(["Lakeside", "Summit", "Riverside", "Crestwood", "Pinecrest"])} Middle`,
      high: `${pick(["North Ridge", "Central", "Highland", "Valley View", "Westfield"])} High`,
    },
    hasPool: pool,
    isWaterfront: waterfront,
    hasView: view,
    hasBasement: !isLand && !isCondo && chance(hood.basementChance ?? 0.1),
    isNewConstruction: newConstruction,
    isSingleStory: stories === 1 && !isCondo,
    virtualTourUrl: chance(0.25) ? "https://my.matterport.com/show/?m=demo" : null,
    videoUrl: null,
    listAgentMlsId: null,
    listAgentName:
      opts.agentName ??
      `${pick(["Chris", "Jordan", "Taylor", "Morgan", "Alex", "Casey", "Jamie", "Riley"])} ${pick(["Nguyen", "Smith", "Garcia", "Johnson", "Patel", "Brown", "Lee", "Wilson"])}`,
    listAgentPhone: `(${pick(["404", "678", "770"])}) 555-${String(intBetween(1000, 9999))}`,
    listAgentEmail: null,
    listOfficeName: opts.office,
    listOfficeMlsId: null,
    sourceModifiedAt: daysAgo(Math.max(0, Math.min(dom, intBetween(0, 10)))),
    statusChangedAt:
      status === "active" || status === "coming_soon"
        ? listDate
        : daysAgo(intBetween(1, Math.max(2, dom))),
    media: buildMedia(type, photoCount),
    openHouses:
      status === "active" && mode === "sale" && chance(0.25)
        ? [0, ...(chance(0.4) ? [1] : [])].map((dayOffset) => {
            const d = nextWeekend();
            d.setUTCDate(d.getUTCDate() + dayOffset);
            d.setUTCHours(17 + intBetween(0, 1), 0, 0, 0); // 1–2pm Eastern (EDT)
            return {
              sourceKey: null,
              type: "in_person" as const,
              startsAt: d,
              endsAt: new Date(d.getTime() + intBetween(2, 3) * 3_600_000),
              remarks: chance(0.5) ? "Refreshments served. No appointment needed." : null,
            };
          })
        : [],
  };
  return { listing, hood, priceDropFrom: priceDrop ? originalPrice : undefined };
}

let hoodWeightsTotal = 0;
function weightedHood(): Neighborhood {
  hoodWeightsTotal ||= NEIGHBORHOODS.reduce((s, n) => s + n.weight, 0);
  let r = rand() * hoodWeightsTotal;
  for (const n of NEIGHBORHOODS) if ((r -= n.weight) <= 0) return n;
  return NEIGHBORHOODS[0];
}

async function createLogin(input: {
  name: string;
  email: string;
  role: "user" | "agent" | "admin";
  password: string;
}) {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, name: input.name, email: input.email, emailVerified: true, role: input.role });
  await db.insert(accounts).values({
    id: crypto.randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(input.password),
  });
  return id;
}

async function main() {
  const password = process.env.SEED_PASSWORD ?? "adams-demo-2026";
  console.info("Resetting tables…");
  await db.execute(sql`
    TRUNCATE audit_logs, inquiries, saved_searches, saved_listings, listing_events, open_houses,
      listing_media, listings, sync_runs, data_sources, agents, offices, verifications, sessions,
      accounts, users RESTART IDENTITY CASCADE
  `);

  const [office] = await db
    .insert(offices)
    .values({
      slug: "main-office",
      name: "Adams Realty, Inc.",
      phone: "(404) 555-0142",
      email: "hello@adamsrealty.example",
      city: "Atlanta",
      state: "GA",
      mlsOfficeId: "ADAMS01",
    })
    .returning();

  console.info("Creating logins…");
  const adminId = await createLogin({
    name: "Margaret Ellis",
    email: "admin@adamsrealty.example",
    role: "admin",
    password,
  });
  const agentUserIds = [
    adminId,
    await createLogin({
      name: "Daniel Reyes",
      email: "daniel@adamsrealty.example",
      role: "agent",
      password,
    }),
    await createLogin({
      name: "Priya Natarajan",
      email: "priya@adamsrealty.example",
      role: "agent",
      password,
    }),
  ];
  const buyerId = await createLogin({
    name: "Jordan Buyer",
    email: "buyer@example.com",
    role: "user",
    password,
  });

  const agentRows = await db
    .insert(agents)
    .values(
      AGENTS.map((a, i) => ({
        userId: agentUserIds[i] ?? null,
        officeId: office.id,
        slug: slugify(a.name),
        name: a.name,
        title: a.title,
        email: `${a.name.split(" ")[0].toLowerCase()}@adamsrealty.example`,
        phone: `(404) 555-01${String(50 + i)}`,
        bio: a.bio,
        photoUrl: a.photoUrl,
        licenseNumber: `GA ${String(300000 + i * 7919)}`,
        mlsAgentId: `ADAMS-A${i + 1}`,
        specialties: a.specialties,
        languages: a.languages,
        serviceAreas: a.areas,
        yearsExperience: a.years,
        sortOrder: i,
      })),
    )
    .returning();

  const [manualSource, demoSource] = await db
    .insert(dataSources)
    .values([
      { slug: "adams", name: "Adams Realty listings", kind: "manual" as const, config: {} },
      {
        slug: "demo-mls",
        name: "Demo MLS (sample IDX feed)",
        kind: "reso_web_api" as const,
        // Inactive: there's no real endpoint. Point a real source at your MLS's RESO Web API.
        isActive: false,
        config: { resource: "Property", companyOfficeIds: ["ADAMS01"] },
        disclaimer:
          "Listing information is fictional sample data for demonstration only. In production, this notice is replaced by your MLS's required IDX disclaimer.",
      },
    ])
    .returning();

  const toSource = (s: typeof manualSource): PersistSource => ({
    id: s.id,
    slug: s.slug,
    kind: s.kind,
    config: s.config,
  });

  console.info("Generating listings…");
  const total = 170;
  const ourCount = 28;
  const listingIds: string[] = [];
  const ourListings: Array<{ id: string; agentId: string; price: number }> = [];

  for (let i = 0; i < total; i++) {
    const ours = i < ourCount;
    const agent = ours ? agentRows[i % agentRows.length] : null;
    const { listing, priceDropFrom } = generateListing(i + 1, {
      office: ours ? "Adams Realty" : pick(OTHER_BROKERAGES),
      agentName: agent?.name,
    });
    if (agent) {
      listing.listAgentEmail = agent.email;
      listing.listAgentPhone = agent.phone;
    }
    const { id } = await db.transaction((tx) =>
      upsertListing(tx, toSource(ours ? manualSource : demoSource), listing, {
        listAgentId: agent?.id ?? null,
        isFeatured: ours && listing.status === "active" && i % 3 === 0,
      }),
    );
    listingIds.push(id);
    if (agent) ourListings.push({ id, agentId: agent.id, price: listing.listPrice });
    if (priceDropFrom) {
      await db.insert(listingEvents).values({
        listingId: id,
        type: "price_change",
        occurredAt: daysAgo(intBetween(3, 15)),
        price: listing.listPrice,
        previousPrice: priceDropFrom,
      });
    }
  }

  console.info("Adding leads and saved homes…");
  const leadNames = [
    "Avery Thompson",
    "Luis Hernandez",
    "Grace Kim",
    "Noah Williams",
    "Emma Davis",
    "Ethan Brooks",
  ];
  await db.insert(inquiries).values(
    leadNames.map((name, i) => {
      const l = ourListings[i % ourListings.length];
      const type = (["tour", "question", "tour", "offer", "question", "valuation"] as const)[i];
      return {
        type,
        status: (["new", "new", "contacted", "qualified", "new", "new"] as const)[i],
        listingId: type === "valuation" ? null : l.id,
        agentId: type === "valuation" ? null : l.agentId,
        name,
        email: `${name.split(" ")[0].toLowerCase()}@example.com`,
        phone: `(678) 555-${String(2000 + i * 37)}`,
        message:
          type === "tour"
            ? "We'd love to see this one this weekend if possible."
            : type === "offer"
              ? "We're pre-approved and ready to write an offer. What's the seller's timeline?"
              : type === "valuation"
                ? "Thinking about selling our 3/2 in Kirkwood next spring. What's it worth?"
                : "Is the HOA fee inclusive of water and trash?",
        tourAt: type === "tour" ? new Date(nextWeekend().setUTCHours(15, 0, 0, 0)) : null, // 11am Eastern
        tourType: type === "tour" ? ("in_person" as const) : null,
        source: type === "valuation" ? "sell" : "listing",
        createdAt: daysAgo(i * 0.7),
      };
    }),
  );

  await db
    .insert(savedListings)
    .values(
      sample(listingIds.slice(ourCount), 5).map((listingId) => ({ userId: buyerId, listingId })),
    );
  await db.insert(savedSearches).values({
    userId: buyerId,
    name: "3+ bd homes in Decatur under $900K",
    criteria: { mode: "buy", q: "Decatur", beds: 3, maxPrice: 900_000, sort: "newest", page: 1 },
    alertFrequency: "daily",
  });

  const [{ count }] = await db
    .execute<{ count: string }>(sql`select count(*)::text as count from listings`)
    .then((r) => r.rows);
  console.info(`\nSeeded ${count} listings, ${agentRows.length} agents.\n`);
  console.info("Demo logins (password: %s)", password);
  console.info("  admin   admin@adamsrealty.example");
  console.info("  agent   daniel@adamsrealty.example");
  console.info("  agent   priya@adamsrealty.example");
  console.info("  buyer   buyer@example.com\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
